import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadProjects, loadTemplate } from "./config.js";
import { renderTemplateFiles } from "./templates.js";

export function applyTemplateToProject(options: {
  configRoot: string;
  projectName: string;
  templateName: string;
}): void {
  const { configRoot, projectName, templateName } = options;
  const projects = loadProjects(configRoot);
  const project = projects.find((entry) => entry.name === projectName);
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const template = loadTemplate(configRoot, templateName);
  const projectRoot = project.path;
  if (!existsSync(projectRoot)) {
    throw new Error(`Project path does not exist: ${projectRoot}`);
  }

  const renderedTemplates = renderTemplateFiles({
    configRoot,
    template,
    templateVars: project.templateVars,
  });

  const existingFiles = renderedTemplates.filter((entry) =>
    existsSync(join(projectRoot, entry.filePath)),
  );
  if (existingFiles.length > 0) {
    const listed = existingFiles.map((entry) => `- ${entry.filePath}`).join("\n");
    throw new Error(`Cannot apply template ${templateName}; files already exist:\n${listed}`);
  }

  for (const entry of renderedTemplates) {
    const outputPath = join(projectRoot, entry.filePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, entry.content, "utf8");
  }

  const projectFile = join(configRoot, "projects", `${project.name}.json`);
  if (!existsSync(projectFile)) {
    throw new Error(`Project config not found: ${projectFile}`);
  }
  const templates = project.templates ?? [];
  const updatedProject = {
    ...project,
    templates: templates.includes(templateName) ? templates : [...templates, templateName],
  };
  writeFileSync(projectFile, `${JSON.stringify(updatedProject, null, 2)}\n`, "utf8");
}
