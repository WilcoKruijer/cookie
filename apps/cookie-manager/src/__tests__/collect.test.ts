import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectMarkdownReport } from "../collect.js";

function writeFeature(options: {
  repoRoot: string;
  domain: string;
  version: string;
  files: string[];
  templates?: Record<string, string>;
}) {
  const { repoRoot, domain, version, files, templates } = options;
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

describe("collectMarkdownReport", () => {
  it("includes diffs for mismatched files", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "cookie-collect-"));
    const projectRoot = join(repoRoot, "demo");
    mkdirSync(projectRoot, { recursive: true });

    writeFeature({
      repoRoot,
      domain: "lint",
      version: "1.0.0",
      files: ["README.md"],
      templates: {
        "README.md": "hello",
      },
    });

    writeProject({
      repoRoot,
      name: "demo",
      path: projectRoot,
      features: {
        lint: "1.0.0",
      },
    });

    writeFileSync(join(projectRoot, "README.md"), "world", "utf8");

    const report = collectMarkdownReport({
      repoRoot,
      configRoot: join(repoRoot, "config"),
      includeDiffs: true,
    });

    expect(report).toContain("# Cookie Manager Drift Report");
    expect(report).toContain("## demo");
    expect(report).toContain("### Mismatches");
    expect(report).toContain("README.md");
    expect(report).toContain("```diff");
    expect(report).toContain("-hello");
    expect(report).toContain("+world");
  });
});
