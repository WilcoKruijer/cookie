import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
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
      const projectFilePath = join(project.path, filePath);
      const projectContent = existsSync(projectFilePath)
        ? readFileSync(projectFilePath, "utf8")
        : MISSING_MARKER;

      const language = languageTag(filePath);

      lines.push(`### ${filePath}`);
      lines.push("```" + language);
      lines.push(projectContent);
      lines.push("```", "");

      if (includeDiffs) {
        const renderedTemplate = renderTemplate({
          templateContents,
          filePath,
          project,
        });
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
    }
  }

  lines.push("## LLM Prompt");
  lines.push("```text");
  lines.push(buildPrompt(feature.name, templateContents, Boolean(includeDiffs)));
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

function buildPrompt(
  featureName: string,
  templateContents: Map<string, string | null>,
  includeDiffs: boolean,
): string {
  const readmeEntries = [...templateContents.entries()].filter(([filePath]) =>
    isReadme(filePath),
  );
  const readmeSection =
    readmeEntries.length === 0
      ? "Feature README(s): none."
      : [
          "Feature README(s):",
          ...readmeEntries.flatMap(([filePath, content]) => [
            `- ${filePath}`,
            "```md",
            content ?? MISSING_MARKER,
            "```",
          ]),
        ].join("\n");

  const diffNote = includeDiffs ? "- Per-project diffs between rendered templates and files.\n" : "";

  return `You are reviewing drift for the feature "${featureName}".

You are given:
- Canonical template files.
- Feature README(s).
- Per-project current files (or MISSING markers).
${diffNote ? diffNote.trimEnd() + "\n" : ""}

${readmeSection}

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

function isReadme(filePath: string): boolean {
  return basename(filePath).toLowerCase().startsWith("readme");
}

function renderTemplate(options: {
  templateContents: Map<string, string | null>;
  filePath: string;
  project: ProjectConfig;
}): string {
  const { templateContents, filePath, project } = options;
  const templateContent = templateContents.get(filePath) ?? null;
  if (templateContent === null) {
    return MISSING_MARKER;
  }
  return applyTemplateVars(templateContent, project.templateVars);
}
