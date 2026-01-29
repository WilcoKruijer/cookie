import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectCheckReport } from "../check.js";

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createWorkspace(): { repoRoot: string; configRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "cookie-check-"));
  const configRoot = join(repoRoot, "config");
  return { repoRoot, configRoot };
}

describe("collectCheckReport", () => {
  it("orders template files and projects in config order", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "features", "lint", "feature.json"),
      JSON.stringify(
        {
          name: "lint",
          description: "Linting feature",
          files: ["alpha.txt", "beta.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "features", "lint", "files", "alpha.txt"), "alpha\n");
    writeFile(join(configRoot, "features", "lint", "files", "beta.txt"), "beta\n");

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: join(configRoot, "..", "alpha"),
          features: ["lint"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(
      join(configRoot, "projects", "beta.json"),
      JSON.stringify(
        {
          name: "beta",
          path: join(configRoot, "..", "beta"),
          features: ["lint"],
        },
        null,
        2,
      ) + "\n",
    );

    mkdirSync(join(configRoot, "..", "alpha"), { recursive: true });
    mkdirSync(join(configRoot, "..", "beta"), { recursive: true });

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
    });

    const alphaTemplateIndex = report.indexOf("### alpha.txt");
    const betaTemplateIndex = report.indexOf("### beta.txt");
    expect(alphaTemplateIndex).toBeGreaterThan(-1);
    expect(betaTemplateIndex).toBeGreaterThan(alphaTemplateIndex);

    const alphaProjectIndex = report.indexOf("## Project: alpha");
    const betaProjectIndex = report.indexOf("## Project: beta");
    expect(alphaProjectIndex).toBeGreaterThan(-1);
    expect(betaProjectIndex).toBeGreaterThan(alphaProjectIndex);
  });

  it("marks missing templates and includes the LLM prompt", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "features", "lint", "feature.json"),
      JSON.stringify(
        {
          name: "lint",
          description: "Linting feature",
          files: ["missing.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: join(configRoot, "..", "alpha"),
          features: ["lint"],
        },
        null,
        2,
      ) + "\n",
    );

    mkdirSync(join(configRoot, "..", "alpha"), { recursive: true });

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
    });

    expect(report).toContain("### missing.txt");
    expect(report).toContain("```text\nMISSING\n```");
    expect(report).toContain('You are reviewing drift for the feature "lint".');
  });

  it("includes rendered diffs when enabled", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "features", "lint", "feature.json"),
      JSON.stringify(
        {
          name: "lint",
          description: "Linting feature",
          files: ["alpha.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "features", "lint", "files", "alpha.txt"), "alpha\n");

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: join(configRoot, "..", "alpha"),
          features: ["lint"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "..", "alpha", "alpha.txt"), "beta\n");

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
      includeDiffs: true,
    });

    expect(report).toContain("Rendered Diff:");
    expect(report).toContain("```diff");
    expect(report).toContain("-alpha");
    expect(report).toContain("+beta");
  });
});
