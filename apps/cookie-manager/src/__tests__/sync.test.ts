import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectSyncReport } from "../sync.js";

function writeFeature(options: {
  repoRoot: string;
  domain: string;
  version: string;
  files: string[];
  templateFiles?: string[];
  templates?: Record<string, string>;
}) {
  const { repoRoot, domain, version, files, templateFiles, templates } = options;
  const featureRoot = join(repoRoot, "config/features", domain, version);
  const templateRoot = join(featureRoot, "files");
  mkdirSync(templateRoot, { recursive: true });

  const feature = {
    domain,
    version,
    description: `${domain} ${version}`,
    templateRoot: `config/features/${domain}/${version}/files`,
    files,
    templateFiles,
    changes: {},
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

describe("collectSyncReport", () => {
  it("plans writes for missing template files", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-sync-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: ["README.md"],
      templates: { "README.md": "hello" },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: { lint: "1.0.0" },
    });

    const report = collectSyncReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
    });

    expect(report.projects[0].actions).toEqual([
      {
        kind: "write",
        path: "README.md",
        content: "hello",
        source: "lint@1.0.0",
      },
    ]);
  });

  it("uses the prior version as merge base", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-sync-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: ["README.md"],
      templates: { "README.md": "v1" },
    });
    writeFeature({
      repoRoot,
      domain: "lint",
      version: "2.0.0",
      files: ["README.md"],
      templates: { "README.md": "v2" },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: { lint: "2.0.0" },
    });

    writeFileSync(join(projectRoot, "README.md"), "v1", "utf8");

    const report = collectSyncReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
    });

    expect(report.projects[0].actions).toEqual([
      {
        kind: "write",
        path: "README.md",
        content: "v2",
        source: "lint@2.0.0",
      },
    ]);
  });

  it("supports keep-local when merge conflicts occur", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-sync-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: ["README.md"],
      templates: { "README.md": "base\n" },
    });
    writeFeature({
      repoRoot,
      domain: "lint",
      version: "2.0.0",
      files: ["README.md"],
      templates: { "README.md": "remote\n" },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: { lint: "2.0.0" },
    });

    writeFileSync(join(projectRoot, "README.md"), "local\n", "utf8");

    const report = collectSyncReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
      mergeStrategy: "keep-local",
    });

    expect(report.projects[0].actions).toEqual([]);
    expect(report.projects[0].errors).toEqual([]);
    expect(report.projects[0].conflicts).toHaveLength(1);
    expect(report.projects[0].conflicts[0]).toMatchObject({
      path: "README.md",
      type: "merge",
      resolution: "kept local",
    });
  });

  it("writes template-only files when missing but never overwrites them", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-sync-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: [],
      templateFiles: ["prettier.config.mjs"],
      templates: { "prettier.config.mjs": "export default {};" },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: { lint: "1.0.0" },
    });

    let report = collectSyncReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
    });

    expect(report.projects[0].actions).toEqual([
      {
        kind: "write",
        path: "prettier.config.mjs",
        content: "export default {};",
        source: "lint@1.0.0",
      },
    ]);

    writeFileSync(
      join(projectRoot, "prettier.config.mjs"),
      "export default { semi: false };",
      "utf8",
    );

    report = collectSyncReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
    });

    expect(report.projects[0].actions).toEqual([]);
  });
});
