import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FeatureDefinition, ProjectConfig } from "./config.js";
import { loadFeatures, loadProjects } from "./config.js";
import {
  loadJsonMergeFragments,
  mergeJsonFragments,
  type MergeConflict,
  type JsonObject,
  type JsonValue,
} from "./merge.js";
import { applyTemplateVars, resolveTemplateRoot, resolveFeatureTemplates } from "./templates.js";

export type StatusDrift = {
  path: string;
  feature: string;
  kind: "missing" | "mismatch";
  detail?: string;
  matches?: string;
};

export type StatusConflict = {
  path: string;
  type: "ownership" | "json-merge";
  owners: string[];
  detail?: string;
};

export type ProjectStatus = {
  name: string;
  path: string;
  features: string[];
  conflicts: StatusConflict[];
  missing: StatusDrift[];
  mismatches: StatusDrift[];
  ok: boolean;
};

export type StatusReport = {
  projects: ProjectStatus[];
  hasDrift: boolean;
  hasConflicts: boolean;
};

export function collectStatusReport(options: {
  repoRoot: string;
  configRoot: string;
  projectName?: string;
}): StatusReport {
  const { repoRoot, configRoot, projectName } = options;
  const projects = loadProjects(configRoot);
  const features = loadFeatures(configRoot);
  const featureMap = new Map(features.map((feature) => [featureKey(feature), feature]));
  const featureByDomain = groupFeaturesByDomain(features);

  const selectedProjects = projectName
    ? projects.filter((project) => project.name === projectName)
    : projects;

  if (projectName && selectedProjects.length === 0) {
    throw new Error(`Project not found: ${projectName}`);
  }

  const projectStatuses = selectedProjects.map((project) =>
    buildProjectStatus({
      repoRoot,
      project,
      featureMap,
      featureByDomain,
    }),
  );

  const hasConflicts = projectStatuses.some((project) => project.conflicts.length > 0);
  const hasDrift = projectStatuses.some(
    (project) => project.missing.length > 0 || project.mismatches.length > 0,
  );

  return { projects: projectStatuses, hasDrift, hasConflicts };
}

function buildProjectStatus(options: {
  repoRoot: string;
  project: ProjectConfig;
  featureMap: Map<string, FeatureDefinition>;
  featureByDomain: Map<string, FeatureDefinition[]>;
}): ProjectStatus {
  const { repoRoot, project, featureMap, featureByDomain } = options;
  assertProjectPath(project);

  const orderedFeatures = resolveProjectFeatures(project, featureMap);
  const featureNames = orderedFeatures.map(featureKey);
  const conflicts = detectOwnershipConflicts(orderedFeatures);
  const conflictPaths = new Set(conflicts.map((conflict) => conflict.path));

  const missing: StatusDrift[] = [];
  const mismatches: StatusDrift[] = [];

  for (const feature of orderedFeatures) {
    const owner = featureKey(feature);
    const resolved = resolveFeatureTemplates({
      repoRoot,
      feature,
      templateVars: project.templateVars,
    });

    for (const template of resolved.files) {
      if (conflictPaths.has(template.path)) {
        continue;
      }
      const filePath = join(project.path, template.path);
      if (!existsSync(filePath)) {
        missing.push({ path: template.path, feature: owner, kind: "missing" });
        continue;
      }
      const content = readFileSync(filePath, "utf8");
      if (content !== template.content) {
        const matches = findMatchingVersion({
          repoRoot,
          feature,
          filePath: template.path,
          content,
          templateVars: project.templateVars,
          featureByDomain,
        });
        mismatches.push({
          path: template.path,
          feature: owner,
          kind: "mismatch",
          matches,
        });
      }
    }

    if (feature.fileRules) {
      for (const [path, rule] of Object.entries(feature.fileRules)) {
        if (rule.require !== "exists") {
          continue;
        }
        if (conflictPaths.has(path)) {
          continue;
        }
        const filePath = join(project.path, path);
        if (!existsSync(filePath)) {
          missing.push({ path, feature: owner, kind: "missing", detail: "required" });
        }
      }
    }
  }

  const mergeConflicts: StatusConflict[] = [];
  const mergeDrift = detectJsonMergeDrift({
    repoRoot,
    project,
    features: orderedFeatures,
    conflictPaths,
    conflicts: mergeConflicts,
  });
  missing.push(...mergeDrift.missing);
  mismatches.push(...mergeDrift.mismatches);
  conflicts.push(...mergeConflicts);

  const ok = conflicts.length === 0 && missing.length === 0 && mismatches.length === 0;

  return {
    name: project.name,
    path: project.path,
    features: featureNames,
    conflicts,
    missing,
    mismatches,
    ok,
  };
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

function detectOwnershipConflicts(features: FeatureDefinition[]): StatusConflict[] {
  const owners = new Map<string, string[]>();

  for (const feature of features) {
    const owner = featureKey(feature);
    for (const path of feature.files) {
      addOwner(owners, path, owner);
    }
    if (feature.fileRules) {
      for (const path of Object.keys(feature.fileRules)) {
        addOwner(owners, path, owner);
      }
    }
  }

  return [...owners.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([path, list]) => ({
      path,
      type: "ownership",
      owners: list,
    }));
}

function detectJsonMergeDrift(options: {
  repoRoot: string;
  project: ProjectConfig;
  features: FeatureDefinition[];
  conflictPaths: Set<string>;
  conflicts: StatusConflict[];
}): { missing: StatusDrift[]; mismatches: StatusDrift[] } {
  const { repoRoot, project, features, conflictPaths, conflicts } = options;
  const mergeFiles = loadJsonMergeFragments(repoRoot, features, project.templateVars);
  const missing: StatusDrift[] = [];
  const mismatches: StatusDrift[] = [];

  for (const mergeFile of mergeFiles) {
    if (conflictPaths.has(mergeFile.path)) {
      continue;
    }
    const filePath = join(project.path, mergeFile.path);
    if (!existsSync(filePath)) {
      missing.push({
        path: mergeFile.path,
        feature: mergeFile.fragments.map((fragment) => fragment.source).join(", "),
        kind: "missing",
        detail: "json-merge",
      });
      continue;
    }
    let parsed: JsonObject;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8")) as JsonObject;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mismatches.push({
        path: mergeFile.path,
        feature: mergeFile.fragments.map((fragment) => fragment.source).join(", "),
        kind: "mismatch",
        detail: `Invalid JSON: ${message}`,
      });
      continue;
    }
    if (!isPlainObject(parsed)) {
      mismatches.push({
        path: mergeFile.path,
        feature: mergeFile.fragments.map((fragment) => fragment.source).join(", "),
        kind: "mismatch",
        detail: "Expected JSON object",
      });
      continue;
    }
    const { merged, conflicts: jsonConflicts } = mergeJsonFragments(parsed, mergeFile.fragments);
    if (!deepEqual(parsed, merged)) {
      mismatches.push({
        path: mergeFile.path,
        feature: mergeFile.fragments.map((fragment) => fragment.source).join(", "),
        kind: "mismatch",
        detail: "json-merge",
      });
    }
    conflicts.push(...mapJsonMergeConflicts(mergeFile.path, jsonConflicts));
  }

  return { missing, mismatches };
}

function mapJsonMergeConflicts(path: string, conflicts: MergeConflict[]): StatusConflict[] {
  return conflicts.map((conflict) => ({
    path,
    type: "json-merge",
    owners: [conflict.previousSource, conflict.nextSource],
    detail: conflict.path,
  }));
}

function findMatchingVersion(options: {
  repoRoot: string;
  feature: FeatureDefinition;
  filePath: string;
  content: string;
  templateVars?: Record<string, string>;
  featureByDomain: Map<string, FeatureDefinition[]>;
}): string | undefined {
  const { repoRoot, feature, filePath, content, templateVars, featureByDomain } = options;
  const candidates = featureByDomain.get(feature.domain) ?? [];
  const ordered = candidates
    .filter((candidate) => candidate.version !== feature.version)
    .sort((a, b) => compareSemver(a.version, b.version));

  for (const candidate of ordered) {
    if (!candidate.files.includes(filePath)) {
      continue;
    }
    const templateContent = loadTemplateFile(repoRoot, candidate, filePath, templateVars);
    if (templateContent === content) {
      return featureKey(candidate);
    }
  }

  return undefined;
}

function loadTemplateFile(
  repoRoot: string,
  feature: FeatureDefinition,
  filePath: string,
  templateVars?: Record<string, string>,
): string {
  const templateRoot = resolveTemplateRoot(repoRoot, feature);
  const templatePath = join(templateRoot, filePath);
  if (!existsSync(templatePath)) {
    throw new Error(
      `Missing template for ${feature.domain}@${feature.version}: ${templatePath}`,
    );
  }
  return applyTemplateVars(readFileSync(templatePath, "utf8"), templateVars);
}

function assertProjectPath(project: ProjectConfig): void {
  if (!existsSync(project.path)) {
    throw new Error(`Missing project path for ${project.name}: ${project.path}`);
  }
  if (!statSync(project.path).isDirectory()) {
    throw new Error(`Invalid project path for ${project.name}: ${project.path}`);
  }
}

function featureKey(feature: FeatureDefinition): string {
  return `${feature.domain}@${feature.version}`;
}

function addOwner(owners: Map<string, string[]>, path: string, owner: string): void {
  const list = owners.get(path);
  if (list) {
    list.push(owner);
    return;
  }
  owners.set(path, [owner]);
}

function groupFeaturesByDomain(
  features: FeatureDefinition[],
): Map<string, FeatureDefinition[]> {
  const map = new Map<string, FeatureDefinition[]>();
  for (const feature of features) {
    const list = map.get(feature.domain) ?? [];
    list.push(feature);
    map.set(feature.domain, list);
  }
  return map;
}

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aEntries = Object.entries(a);
    const bEntries = Object.entries(b);
    if (aEntries.length !== bEntries.length) {
      return false;
    }
    return aEntries.every(([key, value]) => deepEqual(value, (b as JsonObject)[key]));
  }
  return false;
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
