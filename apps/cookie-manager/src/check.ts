import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { createTwoFilesPatch } from "diff";
import type { FeatureDefinition, ProjectConfig } from "./config.js";
import { loadFeature, loadProjects } from "./config.js";
import { applyTemplateVars } from "./templates.js";

const MISSING_MARKER = "MISSING";

export function collectCheckReport(options: {
  configRoot: string;
  featureName: string;
  projectName?: string;
  includeDiffs?: boolean;
}): string {
  const { configRoot, featureName, projectName, includeDiffs } = options;
  const projects = loadProjects(configRoot);
  const feature = loadFeature(configRoot, featureName);

  const selectedProjects = selectProjects({
    projects,
    feature,
    projectName,
  });

  for (const project of selectedProjects) {
    assertProjectPath(project);
  }

  const lines: string[] = [];
  lines.push("# Cookie Manager Check Report", "");
  const featureReadmePath = join(configRoot, "features", feature.name, "README.md");
  const featureReadme = existsSync(featureReadmePath)
    ? readFileSync(featureReadmePath, "utf8")
    : null;
  if (featureReadme) {
    lines.push("## Feature README");
    lines.push("```md");
    lines.push(featureReadme);
    lines.push("```", "");
  }
  lines.push(`- Feature: ${feature.name}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(
    `- Projects: ${
      selectedProjects.length > 0
        ? selectedProjects.map((project) => project.name).join(", ")
        : "none"
    }`,
  );
  lines.push("");

  lines.push("## Template Files", "");
  const templateContents = new Map<string, string | null>();
  for (const filePath of feature.files) {
    const templatePath = join(configRoot, "features", feature.name, "files", filePath);
    const content = existsSync(templatePath) ? readFileSync(templatePath, "utf8") : null;
    templateContents.set(filePath, content);

    lines.push(`### ${filePath}`);
    const language = languageTag(filePath);
    lines.push("```" + language);
    lines.push(content ?? MISSING_MARKER);
    lines.push("```", "");
  }

  for (const project of selectedProjects) {
    lines.push(`## Project: ${project.name}`);
    lines.push(`Path: \`${project.path}\``);
    lines.push("");

    for (const filePath of feature.files) {
      const projectFilePath = join(project.path, filePath);
      const projectContent = existsSync(projectFilePath)
        ? readFileSync(projectFilePath, "utf8")
        : MISSING_MARKER;

      lines.push(`### ${filePath}`);
      if (includeDiffs) {
        const renderedTemplate = renderTemplate({
          templateContents,
          filePath,
          project,
          ignoredTemplateVariables: feature.ignoredTemplateVariables,
        });
        if (renderedTemplate === MISSING_MARKER || projectContent === MISSING_MARKER) {
          lines.push("**File is missing**", "");
        } else if (renderedTemplate === projectContent) {
          lines.push("_files are identical_", "");
        } else {
          lines.push("Rendered Diff:");
          lines.push("```diff");
          lines.push(
            createTwoFilesPatch(
              `template/${filePath}`,
              `project/${filePath}`,
              renderedTemplate,
              projectContent,
              "",
              "",
              { context: 3 },
            ).trimEnd(),
          );
          lines.push("```", "");
        }
      } else {
        const language = languageTag(filePath);
        lines.push("```" + language);
        lines.push(projectContent);
        lines.push("```", "");
      }
    }
  }

  lines.push("## LLM Prompt");
  lines.push("```text");
  lines.push(buildPrompt(feature.name, Boolean(includeDiffs)));
  lines.push("```");

  return lines.join("\n");
}

function selectProjects(options: {
  projects: ProjectConfig[];
  feature: FeatureDefinition;
  projectName?: string;
}): ProjectConfig[] {
  const { projects, feature, projectName } = options;
  if (projectName) {
    const project = projects.find((entry) => entry.name === projectName);
    if (!project) {
      throw new Error(`Project not found: ${projectName}`);
    }
    if (!project.features.includes(feature.name)) {
      throw new Error(`Project ${project.name} does not include feature ${feature.name}.`);
    }
    return [project];
  }

  return projects.filter((project) => project.features.includes(feature.name));
}

function assertProjectPath(project: ProjectConfig): void {
  if (!existsSync(project.path)) {
    throw new Error(`Missing project path for ${project.name}: ${project.path}`);
  }
  if (!statSync(project.path).isDirectory()) {
    throw new Error(`Invalid project path for ${project.name}: ${project.path}`);
  }
}

function languageTag(filePath: string): string {
  const ext = extname(filePath).slice(1);
  if (!ext) {
    return "text";
  }
  const normalized = ext.toLowerCase();
  const known = new Set(["json", "yml", "yaml", "ts", "js", "md", "mjs", "cjs"]);
  return known.has(normalized) ? normalized : "text";
}

function buildPrompt(featureName: string, includeDiffs: boolean): string {
  const diffNote = includeDiffs
    ? "- Per-project diffs between rendered templates and files.\n"
    : "";

  return `You are reviewing drift for the feature "${featureName}", defined as part of the Cookie 
Manager.

Note: if the user asked you to run the command that produced this output, you should follow the
      instructions below.

You are given:
- Canonical template files.
- Per-project current files (or MISSING markers).
${diffNote ? diffNote.trimEnd() + "\n" : ""}

Task:
1. For each file, compare the rendered template to the project file and summarize drift.
2. Decide whether the best fix is to update the template, update one or more projects, or both.
3. Propose template updates when multiple projects share improvements or the template is outdated.
4. Propose project updates when a project should align with the template.
5. Present all suggestions in clear Markdown with sections:
   - Summary
   - Suggested Template Updates (grouped by file path)
   - Suggested Project Updates (grouped by project, then file path)
6. If a template file is missing, recommend what content should be added.
7. If a project file is missing, recommend whether it should be created from the template or
   removed from the feature.

Do not edit files directly. Provide recommendations only.
Output ONLY the suggestion-report in Markdown. Do not include any other commentary or preamble.

Example output:
\`\`\`markdown
# Suggestion Report

## Summary
- ...

## Suggested Template Updates
### path/to/template.file
- ...

## Suggested Project Updates
### project-name
#### path/to/project.file
- ...
\`\`\``;
}

function renderTemplate(options: {
  templateContents: Map<string, string | null>;
  filePath: string;
  project: ProjectConfig;
  ignoredTemplateVariables?: string[];
}): string {
  const { templateContents, filePath, project, ignoredTemplateVariables } = options;
  const templateContent = templateContents.get(filePath) ?? null;
  if (templateContent === null) {
    return MISSING_MARKER;
  }
  return applyTemplateVars(templateContent, project.templateVars, {
    ignoredVariables: ignoredTemplateVariables,
  });
}
