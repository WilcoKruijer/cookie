import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectStatusReport } from "../status.js";

function writeFeature(options: {
  repoRoot: string;
  domain: string;
  version: string;
  files: string[];
  fileRules?: Record<string, { require: "exists" }>;
  fileMerge?: { json: string[] };
  templates?: Record<string, string>;
}) {
  const { repoRoot, domain, version, files, fileRules, fileMerge, templates } = options;
  const featureRoot = join(repoRoot, "config/features", domain, version);
  const templateRoot = join(featureRoot, "files");
  mkdirSync(templateRoot, { recursive: true });

  const feature = {
    domain,
    version,
    description: `${domain} ${version}`,
    templateRoot: `config/features/${domain}/${version}/files`,
    files,
    changes: {},
    fileRules: fileRules ?? {},
    fileMerge,
  };
  writeFileSync(join(featureRoot, "feature.json"), JSON.stringify(feature, null, 2), "utf8");

  if (templates) {
    for (const [path, content] of Object.entries(templates)) {
      const target = join(templateRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, "utf8");
    }
  }
}

function writeProject(options: {
  repoRoot: string;
  name: string;
  path: string;
  features: Record<string, string>;
}) {
  const { repoRoot, name, path, features } = options;
  const projectsDir = join(repoRoot, "config/projects");
  mkdirSync(projectsDir, { recursive: true });
  const data = { name, path, features };
  writeFileSync(join(projectsDir, `${name}.json`), JSON.stringify(data, null, 2), "utf8");
}

describe("collectStatusReport", () => {
  it("reports missing, mismatch, conflicts, and version matches", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-status-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: ["README.md", "missing.txt", "shared.txt"],
      templates: {
        "README.md": "lint v1",
        "missing.txt": "missing",
        "shared.txt": "shared",
      },
    });
    writeFeature({
      repoRoot,
      domain: "lint",
      version: "2.0.0",
      files: ["README.md"],
      templates: {
        "README.md": "lint v2",
      },
    });
    writeFeature({
      repoRoot,
      domain: "ci",
      version: "1.0.0",
      files: ["shared.txt"],
      templates: {
        "shared.txt": "shared",
      },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: {
        lint: "1.0.0",
        ci: "1.0.0",
      },
    });

    writeFileSync(join(projectRoot, "README.md"), "lint v2", "utf8");

    const report = collectStatusReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
    });

    expect(report.projects).toHaveLength(1);
    const project = report.projects[0];
    expect(project.conflicts).toEqual([
      {
        path: "shared.txt",
        type: "ownership",
        owners: ["lint@1.0.0", "ci@1.0.0"],
      },
    ]);
    expect(project.missing).toEqual([
      {
        path: "missing.txt",
        feature: "lint@1.0.0",
        kind: "missing",
      },
    ]);
    expect(project.mismatches).toEqual([
      {
        path: "README.md",
        feature: "lint@1.0.0",
        kind: "mismatch",
        matches: "lint@2.0.0",
      },
    ]);
  });

  it("reports json merge drift and conflicts", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-status-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: [],
      fileMerge: { json: ["package.json"] },
      templates: {
        "package.json": JSON.stringify({ scripts: { lint: "oxlint ." } }),
      },
    });
    writeFeature({
      repoRoot,
      domain: "ci",
      version: "1.0.0",
      files: [],
      fileMerge: { json: ["package.json"] },
      templates: {
        "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
      },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: {
        lint: "1.0.0",
        ci: "1.0.0",
      },
    });

    writeFileSync(join(projectRoot, "package.json"), JSON.stringify({}), "utf8");

    const report = collectStatusReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
    });

    const project = report.projects[0];
    expect(project.mismatches).toEqual([
      {
        path: "package.json",
        feature: "lint@1.0.0, ci@1.0.0",
        kind: "mismatch",
        detail: "json-merge",
      },
    ]);
    expect(project.conflicts).toEqual([
      {
        path: "package.json",
        type: "json-merge",
        owners: ["lint@1.0.0", "ci@1.0.0"],
        detail: "scripts.lint",
      },
    ]);
  });
});
