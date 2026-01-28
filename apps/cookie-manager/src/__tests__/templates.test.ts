import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FeatureDefinition } from "../config.js";
import { resolveFeatureTemplates } from "../templates.js";

describe("resolveFeatureTemplates", () => {
  it("loads templates and applies template vars", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "cookie-templates-"));
    const templateRoot = join(tempRoot, "config/features/docs/1.0.0/files");
    mkdirSync(templateRoot, { recursive: true });
    writeFileSync(
      join(templateRoot, "README.md"),
      "Hello {{orgName}}/{{repoName}}!",
      "utf8",
    );

    const feature: FeatureDefinition = {
      domain: "docs",
      version: "1.0.0",
      description: "docs",
      templateRoot: "config/features/docs/1.0.0/files",
      files: ["README.md"],
      changes: {},
      fileRules: {},
    };

    const resolved = resolveFeatureTemplates({
      repoRoot: tempRoot,
      feature,
      templateVars: { orgName: "wilco", repoName: "cookie" },
    });

    expect(resolved.files).toEqual([
      { path: "README.md", content: "Hello wilco/cookie!" },
    ]);
    expect(resolved.renames).toEqual({});
    expect(resolved.deletes).toEqual([]);
  });

  it("throws when a template var is missing", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "cookie-templates-"));
    const templateRoot = join(tempRoot, "config/features/docs/1.0.0/files");
    mkdirSync(templateRoot, { recursive: true });
    writeFileSync(join(templateRoot, "README.md"), "Hello {{orgName}}!", "utf8");

    const feature: FeatureDefinition = {
      domain: "docs",
      version: "1.0.0",
      description: "docs",
      templateRoot: "config/features/docs/1.0.0/files",
      files: ["README.md"],
      changes: {},
      fileRules: {},
    };

    expect(() =>
      resolveFeatureTemplates({ repoRoot: tempRoot, feature, templateVars: {} }),
    ).toThrow(/Missing template var/);
  });

  it("includes rename/delete metadata for applicable versions", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "cookie-templates-"));
    const feature: FeatureDefinition = {
      domain: "docs",
      version: "1.2.0",
      description: "docs",
      templateRoot: "config/features/docs/1.2.0/files",
      files: [],
      changes: {
        "1.1.0": {
          renames: { "old.md": "new.md" },
          deletes: ["drop.md"],
        },
        "1.2.0": {
          renames: { "new.md": "final.md" },
        },
      },
      fileRules: {},
    };

    const resolved = resolveFeatureTemplates({ repoRoot: tempRoot, feature });

    expect(resolved.renames).toEqual({
      "old.md": "final.md",
      "new.md": "final.md",
    });
    expect(resolved.deletes).toEqual(["drop.md"]);
  });
});
