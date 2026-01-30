import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TemplateDefinition } from "./config.js";

type TemplateVars = Record<string, string> | undefined;
type TemplateVarOptions = {
  ignoredVariables?: string[];
};

export function applyTemplateVars(
  content: string,
  templateVars: TemplateVars,
  options?: TemplateVarOptions,
): string {
  const matches = [...content.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)];
  if (matches.length === 0) {
    return content;
  }

  const ignored = new Set(options?.ignoredVariables ?? []);
  const replacements = templateVars ?? {};
  for (const match of matches) {
    const key = match[1];
    if (!(key in replacements) && !ignored.has(key)) {
      throw new Error(`Missing template var: ${key}`);
    }
  }

  return content.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (full, key: string) => {
    if (key in replacements) {
      return String(replacements[key]);
    }
    return full;
  });
}

export function renderTemplateFiles(options: {
  configRoot: string;
  template: TemplateDefinition;
  templateVars?: Record<string, string>;
}): { filePath: string; content: string }[] {
  const { configRoot, template, templateVars } = options;
  const baseDir = join(configRoot, "templates", template.name, "files");
  return template.files.map((filePath) => {
    const templatePath = join(baseDir, filePath);
    if (!existsSync(templatePath)) {
      throw new Error(`Missing template file for ${template.name}: ${templatePath}`);
    }
    const content = readFileSync(templatePath, "utf8");
    return {
      filePath,
      content: applyTemplateVars(content, templateVars),
    };
  });
}
