import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { FeatureDefinition, ProjectConfig } from "./config.js";
import { loadFeature, loadProjects } from "./config.js";
import { applyTemplateVars } from "./templates.js";

const MISSING_MARKER = "MISSING";

export function collectCheckReport(options: {
  configRoot: string;
  featureName: string;
  projectName?: string;
}): string {
  const { configRoot, featureName, projectName } = options;
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
  lines.push(`- Feature: ${feature.name}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(
    `- Projects: ${
      selectedProjects.length > 0 ? selectedProjects.map((project) => project.name).join(", ") : "none"
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
      const templateContent = templateContents.get(filePath) ?? null;
      const renderedTemplate =
        templateContent === null
          ? MISSING_MARKER
          : applyTemplateVars(templateContent, project.templateVars);

      const projectFilePath = join(project.path, filePath);
      const projectContent = existsSync(projectFilePath)
        ? readFileSync(projectFilePath, "utf8")
        : MISSING_MARKER;

      const language = languageTag(filePath);

      lines.push(`### ${filePath}`);
      lines.push("Rendered Template:");
      lines.push("```" + language);
      lines.push(renderedTemplate);
      lines.push("```");
      lines.push("Project File:");
      lines.push("```" + language);
      lines.push(projectContent);
      lines.push("```", "");
    }
  }

  lines.push("## LLM Prompt");
  lines.push("```text");
  lines.push(buildPrompt(feature.name));
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
    return project.features.includes(feature.name) ? [project] : [];
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

function buildPrompt(featureName: string): string {
  return `You are reviewing drift for the feature "${featureName}".

You are given:
- Canonical template files.
- Per-project rendered templates.
- Per-project current files (or MISSING markers).

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

Do not edit files directly. Provide recommendations only.`;
}
