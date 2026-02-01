import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
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
    expect(report).toContain('You are reviewing drift for the feature "lint"');
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
    expect(report).not.toContain("```text\nbeta\n```");
  });

  it("shows the feature README at the top and not in the LLM prompt", () => {
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

    writeFile(join(configRoot, "features", "lint", "README.md"), "lint readme\n");
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

    mkdirSync(join(configRoot, "..", "alpha"), { recursive: true });

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
    });

    const readmeIndex = report.indexOf("## Feature README");
    const featureIndex = report.indexOf("- Feature: lint");
    const promptIndex = report.indexOf("## LLM Prompt");

    expect(readmeIndex).toBeGreaterThan(-1);
    expect(featureIndex).toBeGreaterThan(readmeIndex);
    expect(report).toContain("lint readme");
    expect(report.lastIndexOf("lint readme")).toBeLessThan(promptIndex);
  });

  it("notes identical files when diffs are enabled", () => {
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

    writeFile(join(configRoot, "..", "alpha", "alpha.txt"), "alpha\n");

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
      includeDiffs: true,
    });

    expect(report).toContain("_files are identical_");
  });

  it("shows missing file marker in diff mode", () => {
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

    mkdirSync(join(configRoot, "..", "alpha"), { recursive: true });

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
      includeDiffs: true,
    });

    expect(report).toContain("**File is missing**");
    expect(report).not.toContain("```diff");
  });

  it("ignores template variables configured on the feature", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "features", "lint", "feature.json"),
      JSON.stringify(
        {
          name: "lint",
          description: "Linting feature",
          files: ["alpha.txt"],
          ignoredTemplateVariables: ["SKIP_ME"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "features", "lint", "files", "alpha.txt"), "alpha {{SKIP_ME}}\n");

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

    writeFile(join(configRoot, "..", "alpha", "alpha.txt"), "alpha {{SKIP_ME}}\n");

    const report = collectCheckReport({
      configRoot,
      featureName: "lint",
      includeDiffs: true,
    });

    expect(report).toContain("_files are identical_");
  });

  it("reports symlink status and normalizes link targets", () => {
    const { configRoot } = createWorkspace();
    const projectRoot = join(configRoot, "..", "alpha");

    writeFile(
      join(configRoot, "features", "links", "feature.json"),
      JSON.stringify(
        {
          name: "links",
          description: "Linking feature",
          files: [],
          links: [
            {
              path: "linked.txt",
              target: "nested/../target.txt",
              type: "file",
            },
          ],
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
          path: projectRoot,
          features: ["links"],
        },
        null,
        2,
      ) + "\n",
    );

    mkdirSync(projectRoot, { recursive: true });
    symlinkSync("nested/../target.txt", join(projectRoot, "linked.txt"), "file");

    const report = collectCheckReport({
      configRoot,
      featureName: "links",
    });

    expect(report).toContain("## Template Links");
    expect(report).toContain("linked.txt -> nested/../target.txt");
    expect(report).toContain("### Links");
    expect(report).toContain("status: OK");
  });

  it("errors when a project does not include the feature", () => {
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

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: join(configRoot, "..", "alpha"),
          features: ["other"],
        },
        null,
        2,
      ) + "\n",
    );

    mkdirSync(join(configRoot, "..", "alpha"), { recursive: true });

    expect(() =>
      collectCheckReport({
        configRoot,
        featureName: "lint",
        projectName: "alpha",
      }),
    ).toThrowError("Project alpha does not include feature lint.");
  });
});
