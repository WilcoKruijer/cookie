import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureDefinition } from "./config.js";
import { applyTemplateVars, resolveTemplateRoot } from "./templates.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type JsonFragment = {
  source: string;
  value: JsonObject;
};

export type MergeConflict = {
  path: string;
  previousSource: string;
  nextSource: string;
  previousValue: JsonValue;
  nextValue: JsonValue;
};

export type MergeResult = {
  merged: JsonObject;
  conflicts: MergeConflict[];
};

export type JsonMergeFile = {
  path: string;
  fragments: JsonFragment[];
};

export function loadJsonMergeFragments(
  repoRoot: string,
  features: FeatureDefinition[],
  templateVars?: Record<string, string>,
): JsonMergeFile[] {
  const files = new Map<string, JsonFragment[]>();

  for (const feature of features) {
    const jsonFiles = feature.fileMerge?.json ?? [];
    if (jsonFiles.length === 0) {
      continue;
    }
    const templateRoot = resolveTemplateRoot(repoRoot, feature);

    for (const filePath of jsonFiles) {
      const fragmentPath = join(templateRoot, filePath);
      if (!existsSync(fragmentPath)) {
        throw new Error(
          `Missing JSON merge fragment for ${feature.domain}@${feature.version}: ${fragmentPath}`,
        );
      }
      const fragment = readJsonObject(fragmentPath, templateVars);
      const list = files.get(filePath) ?? [];
      list.push({
        source: `${feature.domain}@${feature.version}`,
        value: fragment,
      });
      files.set(filePath, list);
    }
  }

  return [...files.entries()].map(([path, fragments]) => ({ path, fragments }));
}

export function mergeJsonFragments(base: JsonObject, fragments: JsonFragment[]): MergeResult {
  const merged = structuredClone(base);
  const conflicts: MergeConflict[] = [];
  const sources = new Map<string, string>();

  for (const fragment of fragments) {
    mergeObject(merged, fragment.value, fragment.source, sources, conflicts, []);
  }

  return { merged, conflicts };
}

function mergeObject(
  target: JsonObject,
  fragment: JsonObject,
  source: string,
  sources: Map<string, string>,
  conflicts: MergeConflict[],
  path: string[],
): void {
  for (const [key, fragmentValue] of Object.entries(fragment)) {
    const nextPath = [...path, key];
    const existingValue = target[key];

    if (isPlainObject(fragmentValue)) {
      if (isPlainObject(existingValue)) {
        mergeObject(existingValue, fragmentValue, source, sources, conflicts, nextPath);
        continue;
      }

      if (existingValue !== undefined) {
        recordConflictIfNeeded(existingValue, fragmentValue, source, sources, conflicts, nextPath);
      }
      clearNestedSources(sources, nextPath);
      const nextTarget: JsonObject = {};
      target[key] = nextTarget;
      mergeObject(nextTarget, fragmentValue, source, sources, conflicts, nextPath);
      continue;
    }

    recordConflictIfNeeded(existingValue, fragmentValue, source, sources, conflicts, nextPath);
    clearNestedSources(sources, nextPath);
    target[key] = structuredClone(fragmentValue);
    sources.set(formatPath(nextPath), source);
  }
}

function recordConflictIfNeeded(
  existingValue: JsonValue | undefined,
  nextValue: JsonValue,
  source: string,
  sources: Map<string, string>,
  conflicts: MergeConflict[],
  path: string[],
): void {
  const pathKey = formatPath(path);
  const previousSource = sources.get(pathKey);
  if (!previousSource || previousSource === source) {
    return;
  }
  if (existingValue === undefined) {
    return;
  }
  if (deepEqual(existingValue, nextValue)) {
    return;
  }
  conflicts.push({
    path: pathKey,
    previousSource,
    nextSource: source,
    previousValue: existingValue,
    nextValue,
  });
}

function clearNestedSources(sources: Map<string, string>, path: string[]): void {
  const pathKey = formatPath(path);
  for (const key of sources.keys()) {
    if (key === pathKey || key.startsWith(`${pathKey}.`)) {
      sources.delete(key);
    }
  }
}

function formatPath(path: string[]): string {
  return path.length === 0 ? "<root>" : path.join(".");
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

function readJsonObject(filePath: string, templateVars?: Record<string, string>): JsonObject {
  let parsed: unknown;
  try {
    const content = applyTemplateVars(readFileSync(filePath, "utf8"), templateVars);
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Expected JSON object in ${filePath}.`);
  }
  return parsed;
}
