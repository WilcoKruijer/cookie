import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { FeatureDefinition, ProjectConfig } from "./config.js";
import { loadFeatures, loadProjects } from "./config.js";
import {
  collectStatusReport,
  type ProjectStatus,
  type StatusDrift,
  type StatusReport,
} from "./status.js";
import { loadJsonMergeFragments, mergeJsonFragments, type JsonObject } from "./merge.js";
import { resolveFeatureTemplates } from "./templates.js";

export function collectMarkdownReport(options: {
  repoRoot: string;
  configRoot: string;
  projectName?: string;
  includeDiffs?: boolean;
  report?: StatusReport;
}): string {
  const { repoRoot, configRoot, projectName, includeDiffs, report } = options;
  const statusReport =
    report ?? collectStatusReport({ repoRoot, configRoot, projectName });
  const projects = loadProjects(configRoot);
  const features = loadFeatures(configRoot);
  const projectMap = new Map(projects.map((project) => [project.name, project]));
  const featureMap = new Map(features.map((feature) => [featureKey(feature), feature]));

  const lines: string[] = ["# Cookie Manager Drift Report", ""];

  if (statusReport.projects.length === 0) {
    lines.push("No projects configured.", "");
    return lines.join("\n");
  }

  for (const projectStatus of statusReport.projects) {
    const project = projectMap.get(projectStatus.name);
    if (!project) {
      continue;
    }
    const context = buildProjectContext({
      repoRoot,
      project,
      featureMap,
      conflictPaths: new Set(projectStatus.conflicts.map((conflict) => conflict.path)),
    });
    lines.push(`## ${projectStatus.name}`);
    lines.push(`Path: \`${projectStatus.path}\``);
    lines.push("");

    if (projectStatus.ok) {
      lines.push("No drift or conflicts detected.", "");
      continue;
    }

    appendConflicts(lines, projectStatus);
    appendDrift(lines, projectStatus, context, includeDiffs);
  }

  return lines.join("\n");
}

type ProjectContext = {
  project: ProjectConfig;
  templateIndex: Map<string, TemplateEntry>;
  jsonMergeIndex: Map<string, JsonMergeEntry>;
  conflictPaths: Set<string>;
};

type TemplateEntry = {
  content: string;
  feature: string;
};

type JsonMergeEntry = {
  expected: string;
  actual: string;
  sources: string[];
};

function appendConflicts(lines: string[], project: ProjectStatus): void {
  if (project.conflicts.length === 0) {
    return;
  }
  lines.push("### Conflicts");
  for (const conflict of project.conflicts) {
    const detail = conflict.detail ? ` (${conflict.detail})` : "";
    lines.push(
      `- \`${conflict.path}\` (${conflict.type}) ${conflict.owners.join(", ")}${detail}`,
    );
  }
  lines.push("");
}

function appendDrift(
  lines: string[],
  project: ProjectStatus,
  context: ProjectContext,
  includeDiffs?: boolean,
): void {
  if (project.missing.length > 0) {
    lines.push("### Missing");
    for (const entry of project.missing) {
      appendDriftEntry(lines, entry, context, includeDiffs);
    }
    lines.push("");
  }

  if (project.mismatches.length > 0) {
    lines.push("### Mismatches");
    for (const entry of project.mismatches) {
      appendDriftEntry(lines, entry, context, includeDiffs);
    }
    lines.push("");
  }
}

function appendDriftEntry(
  lines: string[],
  entry: StatusDrift,
  context: ProjectContext,
  includeDiffs?: boolean,
): void {
  const matches = entry.matches ? ` matches ${entry.matches}` : "";
  const detail = entry.detail ? ` (${entry.detail})` : "";
  lines.push(`- \`${entry.path}\` (${entry.feature})${matches}${detail}`);

  if (!includeDiffs || context.conflictPaths.has(entry.path)) {
    return;
  }

  const diff = buildDiff(entry, context);
  if (!diff) {
    return;
  }
  lines.push("", `Diff for \`${entry.path}\`:`);
  lines.push("```diff");
  lines.push(diff.trimEnd());
  lines.push("```");
}

function buildDiff(entry: StatusDrift, context: ProjectContext): string | null {
  const jsonMerge = context.jsonMergeIndex.get(entry.path);
  if (jsonMerge) {
    return createUnifiedDiff(jsonMerge.expected, jsonMerge.actual);
  }

  const template = context.templateIndex.get(entry.path);
  if (!template) {
    return null;
  }

  const filePath = join(context.project.path, entry.path);
  const actual = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  return createUnifiedDiff(template.content, actual);
}

function buildProjectContext(options: {
  repoRoot: string;
  project: ProjectConfig;
  featureMap: Map<string, FeatureDefinition>;
  conflictPaths: Set<string>;
}): ProjectContext {
  const { repoRoot, project, featureMap, conflictPaths } = options;
  const orderedFeatures = resolveProjectFeatures(project, featureMap);
  const templateIndex = buildTemplateIndex({
    repoRoot,
    features: orderedFeatures,
    templateVars: project.templateVars,
  });
  const jsonMergeIndex = buildJsonMergeIndex({
    repoRoot,
    project,
    features: orderedFeatures,
  });

  return {
    project,
    templateIndex,
    jsonMergeIndex,
    conflictPaths,
  };
}

function buildTemplateIndex(options: {
  repoRoot: string;
  features: FeatureDefinition[];
  templateVars?: Record<string, string>;
}): Map<string, TemplateEntry> {
  const { repoRoot, features, templateVars } = options;
  const index = new Map<string, TemplateEntry>();

  for (const feature of features) {
    const resolved = resolveFeatureTemplates({ repoRoot, feature, templateVars });
    for (const template of resolved.files) {
      index.set(template.path, {
        content: template.content,
        feature: featureKey(feature),
      });
    }
  }

  return index;
}

function buildJsonMergeIndex(options: {
  repoRoot: string;
  project: ProjectConfig;
  features: FeatureDefinition[];
}): Map<string, JsonMergeEntry> {
  const { repoRoot, project, features } = options;
  const index = new Map<string, JsonMergeEntry>();
  const mergeFiles = loadJsonMergeFragments(repoRoot, features, project.templateVars);

  for (const mergeFile of mergeFiles) {
    const filePath = join(project.path, mergeFile.path);
    const actual = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const parsed = parseJsonObject(actual);
    const base = parsed ?? {};
    const { merged } = mergeJsonFragments(base, mergeFile.fragments);
    index.set(mergeFile.path, {
      expected: stringifyJson(merged),
      actual,
      sources: mergeFile.fragments.map((fragment) => fragment.source),
    });
  }

  return index;
}

function resolveProjectFeatures(
  project: ProjectConfig,
  featureMap: Map<string, FeatureDefinition>,
): FeatureDefinition[] {
  return Object.entries(project.features).map(([domain, version]) => {
    const key = `${domain}@${version}`;
    const feature = featureMap.get(key);
    if (!feature) {
      throw new Error(`Feature not found: ${key} (project ${project.name}).`);
    }
    return feature;
  });
}

function parseJsonObject(content: string): JsonObject | null {
  if (!content.trim()) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }
  return parsed;
}

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyJson(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createUnifiedDiff(expected: string, actual: string): string | null {
  const tempDir = mkdtempSync(join(tmpdir(), "cookie-manager-diff-"));
  const expectedPath = join(tempDir, "expected");
  const actualPath = join(tempDir, "actual");

  try {
    writeFileSync(expectedPath, expected, "utf8");
    writeFileSync(actualPath, actual, "utf8");
    const diff =
      runDiffCommand("diff", ["-u", expectedPath, actualPath]) ??
      runDiffCommand("git", [
        "diff",
        "--no-index",
        "--no-color",
        "--",
        expectedPath,
        actualPath,
      ]);

    if (!diff || diff.trim().length === 0) {
      return null;
    }

    return diff;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runDiffCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    return null;
  }
  return typeof result.stdout === "string" ? result.stdout : null;
}

function featureKey(feature: FeatureDefinition): string {
  return `${feature.domain}@${feature.version}`;
}
