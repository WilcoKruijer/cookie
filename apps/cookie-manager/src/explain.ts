import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { FeatureDefinition, ProjectConfig } from "./config.js";
import { loadFeatures, loadProjects } from "./config.js";
import { loadJsonMergeFragments } from "./merge.js";
import { collectStatusReport, type StatusConflict, type StatusDrift } from "./status.js";

export type ExplainOwnershipType = "template" | "rule" | "json-merge" | "unknown";

export type ExplainReport = {
  project: ProjectConfig;
  path: string;
  owners: string[];
  ownershipType: ExplainOwnershipType;
  status: "ok" | "missing" | "mismatch" | "conflict" | "unmanaged";
  detail?: string;
  matches?: string;
  conflicts: StatusConflict[];
  fileExists: boolean;
};

export function collectExplainReport(options: {
  repoRoot: string;
  configRoot: string;
  projectName: string;
  filePath: string;
}): ExplainReport {
  const { repoRoot, configRoot, projectName, filePath } = options;
  const projects = loadProjects(configRoot);
  const project = projects.find((entry) => entry.name === projectName);
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }

  const normalizedPath = normalizeFilePath(filePath, project.path);
  const features = loadFeatures(configRoot);
  const featureMap = new Map(features.map((feature) => [featureKey(feature), feature]));
  const orderedFeatures = resolveProjectFeatures(project, featureMap);

  const ownership = resolveOwnership({
    repoRoot,
    project,
    features: orderedFeatures,
    filePath: normalizedPath,
  });

  const statusReport = collectStatusReport({
    repoRoot,
    configRoot,
    projectName,
  });

  const projectStatus = statusReport.projects[0];
  const conflicts = projectStatus
    ? projectStatus.conflicts.filter((conflict) => conflict.path === normalizedPath)
    : [];
  const missing = projectStatus?.missing.find((entry) => entry.path === normalizedPath);
  const mismatch = projectStatus?.mismatches.find((entry) => entry.path === normalizedPath);

  const status = resolveStatus({
    conflicts,
    missing,
    mismatch,
    owners: ownership.owners,
  });

  const fileExists = existsSync(join(project.path, normalizedPath));

  return {
    project,
    path: normalizedPath,
    owners: ownership.owners,
    ownershipType: ownership.ownershipType,
    status,
    detail: missing?.detail ?? mismatch?.detail,
    matches: mismatch?.matches,
    conflicts,
    fileExists,
  };
}

function resolveOwnership(options: {
  repoRoot: string;
  project: ProjectConfig;
  features: FeatureDefinition[];
  filePath: string;
}): { owners: string[]; ownershipType: ExplainOwnershipType } {
  const { repoRoot, project, features, filePath } = options;
  const templateOwners: string[] = [];
  const ruleOwners: string[] = [];

  for (const feature of features) {
    const key = featureKey(feature);
    if (feature.files.includes(filePath)) {
      templateOwners.push(key);
    }
    if (feature.templateFiles?.includes(filePath)) {
      templateOwners.push(key);
    }
    if (feature.fileRules) {
      for (const [rulePath, rule] of Object.entries(feature.fileRules)) {
        if (rule.require === "exists" && rulePath === filePath) {
          ruleOwners.push(key);
        }
      }
    }
  }

  const mergeFiles = loadJsonMergeFragments(repoRoot, features, project.templateVars);
  const mergeEntry = mergeFiles.find((entry) => entry.path === filePath);
  const mergeOwners = mergeEntry ? mergeEntry.fragments.map((fragment) => fragment.source) : [];

  if (mergeOwners.length > 0) {
    return { owners: mergeOwners, ownershipType: "json-merge" };
  }
  if (templateOwners.length > 0) {
    return { owners: templateOwners, ownershipType: "template" };
  }
  if (ruleOwners.length > 0) {
    return { owners: ruleOwners, ownershipType: "rule" };
  }
  return { owners: [], ownershipType: "unknown" };
}

function resolveStatus(options: {
  conflicts: StatusConflict[];
  missing?: StatusDrift;
  mismatch?: StatusDrift;
  owners: string[];
}): ExplainReport["status"] {
  const { conflicts, missing, mismatch, owners } = options;
  if (conflicts.length > 0) {
    return "conflict";
  }
  if (missing) {
    return "missing";
  }
  if (mismatch) {
    return "mismatch";
  }
  if (owners.length === 0) {
    return "unmanaged";
  }
  return "ok";
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

function featureKey(feature: FeatureDefinition): string {
  return `${feature.domain}@${feature.version}`;
}

function normalizeFilePath(filePath: string, projectPath: string): string {
  const cleaned = stripDotSlash(filePath);
  if (isAbsolute(cleaned)) {
    const relativePath = relative(projectPath, cleaned);
    if (!relativePath.startsWith("..") && relativePath !== "") {
      return stripDotSlash(relativePath);
    }
  }
  return cleaned;
}

function stripDotSlash(filePath: string): string {
  return filePath.replace(/^[.][\\/]/, "");
}
