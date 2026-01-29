import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FeatureDefinition } from "../config.js";
import { loadJsonMergeFragments, mergeJsonFragments } from "../merge.js";

describe("mergeJsonFragments", () => {
  it("merges deep objects and replaces arrays", () => {
    const base = {
      scripts: { dev: "dev" },
      list: [1, 2],
    };
    const { merged, conflicts } = mergeJsonFragments(base, [
      { source: "lint@1.0.0", value: { scripts: { lint: "oxlint ." } } },
      { source: "ci@1.0.0", value: { list: [3] } },
    ]);

    expect(merged).toEqual({
      scripts: { dev: "dev", lint: "oxlint ." },
      list: [3],
    });
    expect(conflicts).toEqual([]);
  });

  it("records conflicts when features set different values", () => {
    const { merged, conflicts } = mergeJsonFragments({}, [
      { source: "lint@1.0.0", value: { scripts: { lint: "oxlint ." } } },
      { source: "ci@1.0.0", value: { scripts: { lint: "eslint ." } } },
    ]);

    expect(merged).toEqual({ scripts: { lint: "eslint ." } });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      path: "scripts.lint",
      previousSource: "lint@1.0.0",
      nextSource: "ci@1.0.0",
    });
  });
});

describe("loadJsonMergeFragments", () => {
  it("loads JSON fragments for declared feature files", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "cookie-merge-"));
    const templateRoot = join(tempRoot, "config/features/lint/1.0.0/files");
    mkdirSync(templateRoot, { recursive: true });
    writeFileSync(
      join(templateRoot, "package.json"),
      JSON.stringify({ scripts: { lint: "oxlint ." } }),
      "utf8",
    );

    const features: FeatureDefinition[] = [
      {
        domain: "lint",
        version: "1.0.0",
        description: "linting",
        templateRoot: "config/features/lint/1.0.0/files",
        files: [],
        changes: {},
        fileRules: {},
        fileMerge: { json: ["package.json"] },
      },
    ];

    const mergeFiles = loadJsonMergeFragments(tempRoot, features);
    expect(mergeFiles).toEqual([
      {
        path: "package.json",
        fragments: [
          {
            source: "lint@1.0.0",
            value: { scripts: { lint: "oxlint ." } },
          },
        ],
      },
    ]);
  });
});
