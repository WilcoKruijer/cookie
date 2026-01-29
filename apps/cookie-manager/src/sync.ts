import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FeatureDefinition, ProjectConfig } from "./config.js";
import { loadFeatures, loadProjects } from "./config.js";
import { loadJsonMergeFragments, mergeJsonFragments, type JsonObject } from "./merge.js";
import {
  applyTemplateVars,
  loadTemplateFiles,
  resolveFeatureTemplates,
  resolveTemplateRoot,
} from "./templates.js";
import { createUnifiedDiff } from "./diff.js";

export type MergeStrategy = "none" | "markers" | "keep-local" | "overwrite";

export type SyncAction =
  | {
      kind: "write";
      path: string;
      content: string;
      source: string;
      diff?: string | null;
    }
  | { kind: "delete"; path: string }
  | { kind: "rename"; from: string; to: string };

export type SyncConflict = {
  path: string;
  type: "ownership" | "json-merge" | "merge";
  owners?: string[];
  detail?: string;
  resolution?: string;
};

export type SyncProjectReport = {
  name: string;
  path: string;
  actions: SyncAction[];
  conflicts: SyncConflict[];
  errors: string[];
  ok: boolean;
};

export type SyncReport = {
  projects: SyncProjectReport[];
  hasChanges: boolean;
  hasConflicts: boolean;
};

export function collectSyncReport(options: {
  repoRoot: string;
  configRoot: string;
  projectName?: string;
  includeDiffs?: boolean;
  mergeStrategy?: MergeStrategy;
}): SyncReport {
  const { repoRoot, configRoot, projectName, includeDiffs, mergeStrategy = "none" } = options;
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

  const projectReports = selectedProjects.map((project) =>
    buildProjectSyncReport({
      repoRoot,
      project,
      featureMap,
      featureByDomain,
      includeDiffs,
      mergeStrategy,
    }),
  );

  const hasConflicts = projectReports.some((project) => project.conflicts.length > 0);
  const hasChanges = projectReports.some((project) => project.actions.length > 0);

  return { projects: projectReports, hasChanges, hasConflicts };
}

export function applySyncReport(report: SyncReport): void {
  for (const project of report.projects) {
    if (project.errors.length > 0) {
      continue;
    }
    applyProjectActions(project);
  }
}

function buildProjectSyncReport(options: {
  repoRoot: string;
  project: ProjectConfig;
  featureMap: Map<string, FeatureDefinition>;
  featureByDomain: Map<string, FeatureDefinition[]>;
  includeDiffs?: boolean;
  mergeStrategy: MergeStrategy;
}): SyncProjectReport {
  const { repoRoot, project, featureMap, featureByDomain, includeDiffs, mergeStrategy } = options;
  assertProjectPath(project);

  const orderedFeatures = resolveProjectFeatures(project, featureMap);
  const conflicts = detectOwnershipConflicts(orderedFeatures);
  const conflictPaths = new Set(conflicts.map((conflict) => conflict.path));
  const errors: string[] = [];

  if (conflicts.length > 0) {
    errors.push("Ownership conflicts detected.");
  }

  const mergeFiles = loadJsonMergeFragments(repoRoot, orderedFeatures, project.templateVars);
  const mergePaths = new Set(mergeFiles.map((file) => file.path));
  const actions: SyncAction[] = [];

  for (const mergeFile of mergeFiles) {
    if (conflictPaths.has(mergeFile.path)) {
      continue;
    }
    const filePath = join(project.path, mergeFile.path);
    const actual = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    const parsed = parseJsonObject(actual);
    if (actual.trim().length > 0 && !parsed) {
      errors.push(`Invalid JSON in ${mergeFile.path}.`);
      continue;
    }
    const base = parsed ?? {};
    const { merged, conflicts: jsonConflicts } = mergeJsonFragments(base, mergeFile.fragments);
    if (jsonConflicts.length > 0) {
      for (const conflict of jsonConflicts) {
        conflicts.push({
          path: mergeFile.path,
          type: "json-merge",
          owners: [conflict.previousSource, conflict.nextSource],
          detail: conflict.path,
        });
      }
      errors.push(`JSON merge conflicts detected for ${mergeFile.path}.`);
      continue;
    }
    const expected = stringifyJson(merged);
    if (expected !== actual) {
      actions.push(
        buildWriteAction({
          path: mergeFile.path,
          content: expected,
          source: mergeFile.fragments.map((fragment) => fragment.source).join(", "),
          actual,
          includeDiffs,
        }),
      );
    }
  }

  for (const feature of orderedFeatures) {
    const owner = featureKey(feature);
    const resolved = resolveFeatureTemplates({
      repoRoot,
      feature,
      templateVars: project.templateVars,
    });

    for (const [path, rule] of Object.entries(feature.fileRules ?? {})) {
      if (rule.require !== "exists") {
        continue;
      }
      if (conflictPaths.has(path)) {
        continue;
      }
      const filePath = join(project.path, path);
      if (!existsSync(filePath)) {
        errors.push(`Required file missing: ${path} (${owner}).`);
      }
    }

    for (const template of resolved.files) {
      if (conflictPaths.has(template.path) || mergePaths.has(template.path)) {
        continue;
      }
      const filePath = join(project.path, template.path);
      if (!existsSync(filePath)) {
        actions.push(
          buildWriteAction({
            path: template.path,
            content: template.content,
            source: owner,
            actual: "",
            includeDiffs,
          }),
        );
        continue;
      }
      const actual = readFileSync(filePath, "utf8");
      if (actual === template.content) {
        continue;
      }

      const matchVersion = findMatchingVersion({
        repoRoot,
        feature,
        filePath: template.path,
        content: actual,
        templateVars: project.templateVars,
        featureByDomain,
      });

      const baseFeature = resolveMergeBase({
        feature,
        templatePath: template.path,
        matchVersion,
        featureByDomain,
      });
      if (baseFeature) {
        const base = loadTemplateFile(repoRoot, baseFeature, template.path, project.templateVars);
        const merged = runThreeWayMerge(base, actual, template.content);
        if (merged.conflict) {
          const resolution = resolveMergeConflict(mergeStrategy, {
            actual,
            desired: template.content,
            merged: merged.content,
          });
          conflicts.push({
            path: template.path,
            type: "merge",
            owners: [owner],
            detail: `base ${baseFeature.domain}@${baseFeature.version}`,
            resolution: resolution.note,
          });

          if (resolution.blocked) {
            errors.push(`Merge conflict detected for ${template.path}.`);
            continue;
          }
          if (resolution.content === null) {
            continue;
          }

          actions.push(
            buildWriteAction({
              path: template.path,
              content: resolution.content,
              source: owner,
              actual,
              includeDiffs,
            }),
          );
          continue;
        }

        actions.push(
          buildWriteAction({
            path: template.path,
            content: merged.content,
            source: owner,
            actual,
            includeDiffs,
          }),
        );
        continue;
      }

      actions.push(
        buildWriteAction({
          path: template.path,
          content: template.content,
          source: owner,
          actual,
          includeDiffs,
        }),
      );
    }

    const templateOnly = loadTemplateFiles({
      repoRoot,
      feature,
      paths: feature.templateFiles ?? [],
      templateVars: project.templateVars,
    });
    for (const template of templateOnly) {
      if (conflictPaths.has(template.path) || mergePaths.has(template.path)) {
        continue;
      }
      const filePath = join(project.path, template.path);
      if (!existsSync(filePath)) {
        actions.push(
          buildWriteAction({
            path: template.path,
            content: template.content,
            source: owner,
            actual: "",
            includeDiffs,
          }),
        );
      }
    }

    applyRenameActions({
      actions,
      projectPath: project.path,
      renames: resolved.renames,
    });

    applyDeleteActions({
      actions,
      projectPath: project.path,
      deletes: resolved.deletes,
    });
  }

  validateActionCollisions(actions, errors);

  const ok = actions.length === 0 && conflicts.length === 0 && errors.length === 0;

  return {
    name: project.name,
    path: project.path,
    actions,
    conflicts,
    errors,
    ok,
  };
}

function applyProjectActions(project: SyncProjectReport): void {
  for (const action of project.actions) {
    if (action.kind === "rename") {
      const fromPath = join(project.path, action.from);
      const toPath = join(project.path, action.to);
      mkdirSync(dirname(toPath), { recursive: true });
      renameSync(fromPath, toPath);
    }
  }

  for (const action of project.actions) {
    if (action.kind === "delete") {
      const filePath = join(project.path, action.path);
      rmSync(filePath, { recursive: true, force: true });
    }
  }

  for (const action of project.actions) {
    if (action.kind === "write") {
      const filePath = join(project.path, action.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, action.content, "utf8");
    }
  }
}

function applyRenameActions(options: {
  actions: SyncAction[];
  projectPath: string;
  renames: Record<string, string>;
}): void {
  const { actions, projectPath, renames } = options;

  for (const [from, to] of Object.entries(renames)) {
    const fromPath = join(projectPath, from);
    const toPath = join(projectPath, to);
    if (!existsSync(fromPath)) {
      continue;
    }
    if (existsSync(toPath)) {
      actions.push({ kind: "delete", path: from });
      continue;
    }
    actions.push({ kind: "rename", from, to });
  }
}

function applyDeleteActions(options: {
  actions: SyncAction[];
  projectPath: string;
  deletes: string[];
}): void {
  const { actions, projectPath, deletes } = options;
  const skipped = new Set<string>();

  for (const action of actions) {
    if (action.kind === "write") {
      skipped.add(action.path);
    }
    if (action.kind === "rename") {
      skipped.add(action.from);
      skipped.add(action.to);
    }
  }

  for (const path of deletes) {
    if (skipped.has(path)) {
      continue;
    }
    const filePath = join(projectPath, path);
    if (!existsSync(filePath)) {
      continue;
    }
    actions.push({ kind: "delete", path });
  }
}

function validateActionCollisions(actions: SyncAction[], errors: string[]): void {
  const writePaths = new Set<string>();
  const renameTargets = new Set<string>();
  const renameSources = new Set<string>();

  for (const action of actions) {
    if (action.kind === "write") {
      if (writePaths.has(action.path)) {
        errors.push(`Multiple writes planned for ${action.path}.`);
      }
      if (renameTargets.has(action.path) || renameSources.has(action.path)) {
        errors.push(`Write collides with rename for ${action.path}.`);
      }
      writePaths.add(action.path);
    }
    if (action.kind === "rename") {
      if (renameTargets.has(action.to)) {
        errors.push(`Multiple renames target ${action.to}.`);
      }
      if (writePaths.has(action.to)) {
        errors.push(`Rename target collides with write: ${action.to}.`);
      }
      renameTargets.add(action.to);
      renameSources.add(action.from);
    }
  }
}

function resolveMergeConflict(
  strategy: MergeStrategy,
  inputs: { actual: string; desired: string; merged: string },
): { content: string | null; blocked: boolean; note: string } {
  switch (strategy) {
    case "markers":
      return { content: inputs.merged, blocked: false, note: "markers" };
    case "keep-local":
      return { content: null, blocked: false, note: "kept local" };
    case "overwrite":
      return { content: inputs.desired, blocked: false, note: "overwrote with template" };
    case "none":
    default:
      return { content: null, blocked: true, note: "blocked" };
  }
}

function runThreeWayMerge(
  base: string,
  local: string,
  remote: string,
): {
  content: string;
  conflict: boolean;
} {
  const tempDir = mkdtempSync(join(tmpdir(), "cookie-manager-merge-"));
  const basePath = join(tempDir, "base");
  const localPath = join(tempDir, "local");
  const remotePath = join(tempDir, "remote");

  try {
    writeFileSync(basePath, base, "utf8");
    writeFileSync(localPath, local, "utf8");
    writeFileSync(remotePath, remote, "utf8");
    const result = spawnSync("git", ["merge-file", "-p", basePath, localPath, remotePath], {
      encoding: "utf8",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status && result.status > 1) {
      throw new Error("Failed to run merge tool.");
    }
    return {
      content: result.stdout ?? "",
      conflict: result.status === 1,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

function detectOwnershipConflicts(features: FeatureDefinition[]): SyncConflict[] {
  const owners = new Map<string, string[]>();

  for (const feature of features) {
    const owner = featureKey(feature);
    for (const path of feature.files) {
      addOwner(owners, path, owner);
    }
    for (const path of feature.templateFiles ?? []) {
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
      return candidate.version;
    }
  }

  return undefined;
}

function resolveMergeBase(options: {
  feature: FeatureDefinition;
  templatePath: string;
  matchVersion?: string;
  featureByDomain: Map<string, FeatureDefinition[]>;
}): FeatureDefinition | null {
  const { feature, templatePath, matchVersion, featureByDomain } = options;
  const candidates = (featureByDomain.get(feature.domain) ?? [])
    .filter((candidate) => candidate.files.includes(templatePath))
    .sort((a, b) => compareSemver(a.version, b.version));

  if (matchVersion) {
    const matched = candidates.find((candidate) => candidate.version === matchVersion);
    if (matched) {
      return matched;
    }
  }

  const older = candidates.filter(
    (candidate) => compareSemver(candidate.version, feature.version) < 0,
  );
  return older.length > 0 ? older[older.length - 1] : null;
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
    throw new Error(`Missing template for ${feature.domain}@${feature.version}: ${templatePath}`);
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

function groupFeaturesByDomain(features: FeatureDefinition[]): Map<string, FeatureDefinition[]> {
  const map = new Map<string, FeatureDefinition[]>();
  for (const feature of features) {
    const list = map.get(feature.domain) ?? [];
    list.push(feature);
    map.set(feature.domain, list);
  }
  return map;
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

function buildWriteAction(options: {
  path: string;
  content: string;
  source: string;
  actual: string;
  includeDiffs?: boolean;
}): SyncAction {
  const { path, content, source, actual, includeDiffs } = options;
  if (!includeDiffs) {
    return { kind: "write", path, content, source };
  }
  return {
    kind: "write",
    path,
    content,
    source,
    diff: createUnifiedDiff(content, actual),
  };
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
