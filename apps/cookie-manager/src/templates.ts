import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { FeatureDefinition } from "./config.js";

export type ResolvedTemplateFile = {
  path: string;
  content: string;
};

export type FeatureTemplateResolution = {
  files: ResolvedTemplateFile[];
  renames: Record<string, string>;
  deletes: string[];
};

type TemplateVars = Record<string, string> | undefined;

export function resolveFeatureTemplates(options: {
  repoRoot: string;
  feature: FeatureDefinition;
  templateVars?: Record<string, string>;
}): FeatureTemplateResolution {
  const { repoRoot, feature, templateVars } = options;
  const files = loadTemplateFiles({
    repoRoot,
    feature,
    paths: feature.files,
    templateVars,
  });

  const { renames, deletes } = resolveFeatureChanges(feature);

  return { files, renames, deletes };
}

export function loadTemplateFiles(options: {
  repoRoot: string;
  feature: FeatureDefinition;
  paths: string[];
  templateVars?: Record<string, string>;
}): ResolvedTemplateFile[] {
  const { repoRoot, feature, paths, templateVars } = options;
  const templateRoot = resolveTemplateRoot(repoRoot, feature);
  return paths.map((filePath) => {
    const templatePath = join(templateRoot, filePath);
    if (!existsSync(templatePath)) {
      throw new Error(`Missing template for ${feature.domain}@${feature.version}: ${templatePath}`);
    }
    const content = applyTemplateVars(readFileSync(templatePath, "utf8"), templateVars);
    return { path: filePath, content };
  });
}

export function resolveTemplateRoot(repoRoot: string, feature: FeatureDefinition): string {
  return isAbsolute(feature.templateRoot)
    ? feature.templateRoot
    : join(repoRoot, feature.templateRoot);
}

export function applyTemplateVars(content: string, templateVars: TemplateVars): string {
  const matches = [...content.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)];
  if (matches.length === 0) {
    return content;
  }

  const replacements = templateVars ?? {};
  for (const match of matches) {
    const key = match[1];
    if (!(key in replacements)) {
      throw new Error(`Missing template var: ${key}`);
    }
  }

  return content.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (full, key: string) =>
    String(replacements[key]),
  );
}

function resolveFeatureChanges(feature: FeatureDefinition): {
  renames: Record<string, string>;
  deletes: string[];
} {
  const changeEntries = Object.entries(feature.changes ?? {});
  if (changeEntries.length === 0) {
    return { renames: {}, deletes: [] };
  }

  const applicable = changeEntries
    .filter(([version]) => compareSemver(version, feature.version) <= 0)
    .sort(([a], [b]) => compareSemver(a, b));

  const renames: Record<string, string> = {};
  const deletes = new Set<string>();

  for (const [, change] of applicable) {
    if (change.renames) {
      for (const [from, to] of Object.entries(change.renames)) {
        applyRename(renames, from, to);
        deletes.delete(from);
      }
    }
    if (change.deletes) {
      for (const removed of change.deletes) {
        deletes.add(removed);
      }
    }
  }

  return { renames, deletes: [...deletes] };
}

function applyRename(renames: Record<string, string>, from: string, to: string): void {
  for (const [key, value] of Object.entries(renames)) {
    if (value === from) {
      renames[key] = to;
    }
  }
  renames[from] = to;
}

function compareSemver(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? "0";
    const rightPart = rightParts[index] ?? "0";
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);

    const leftIsNumber = Number.isFinite(leftNumber);
    const rightIsNumber = Number.isFinite(rightNumber);

    if (leftIsNumber && rightIsNumber) {
      if (leftNumber !== rightNumber) {
        return leftNumber < rightNumber ? -1 : 1;
      }
      continue;
    }

    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }

  return 0;
}
