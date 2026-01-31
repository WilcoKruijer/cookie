import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFeature, loadProjects, loadTemplate } from "../config.js";

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createWorkspace(): { repoRoot: string; configRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "cookie-config-"));
  const configRoot = join(repoRoot, "config");
  return { repoRoot, configRoot };
}

describe("config loaders", () => {
  it("accepts templates list in project configs", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: "/tmp/alpha",
          features: ["lint"],
          templates: ["github-actions"],
        },
        null,
        2,
      ) + "\n",
    );

    const projects = loadProjects(configRoot);

    expect(projects[0].templates).toEqual(["github-actions"]);
  });

  it("expands feature file globs", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "features", "lint", "feature.json"),
      JSON.stringify(
        {
          name: "lint",
          description: "Linting feature",
          files: ["*.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "features", "lint", "files", "alpha.txt"), "alpha\n");
    writeFile(join(configRoot, "features", "lint", "files", "beta.txt"), "beta\n");

    const feature = loadFeature(configRoot, "lint");

    expect(feature.files).toEqual(["alpha.txt", "beta.txt"]);
  });

  it("accepts feature links and rejects path conflicts", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "features", "lint", "feature.json"),
      JSON.stringify(
        {
          name: "lint",
          description: "Linting feature",
          files: ["alpha.txt"],
          links: [{ path: "beta.txt", target: "../shared/beta.txt", type: "file" }],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "features", "lint", "files", "alpha.txt"), "alpha\n");

    const feature = loadFeature(configRoot, "lint");

    expect(feature.links).toEqual([
      { path: "beta.txt", target: "../shared/beta.txt", type: "file" },
    ]);

    writeFile(
      join(configRoot, "features", "conflict", "feature.json"),
      JSON.stringify(
        {
          name: "conflict",
          description: "Conflicting feature",
          files: ["alpha.txt"],
          links: [{ path: "alpha.txt", target: "../shared/alpha.txt" }],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "features", "conflict", "files", "alpha.txt"), "alpha\n");

    expect(() => loadFeature(configRoot, "conflict")).toThrowError(
      "Link path conflicts with file path in",
    );
  });

  it("expands template file globs and errors when missing", () => {
    const { configRoot } = createWorkspace();

    writeFile(
      join(configRoot, "templates", "ci", "template.json"),
      JSON.stringify(
        {
          name: "ci",
          description: "CI templates",
          files: ["*.yml"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "templates", "ci", "files", "ci.yml"), "name: ci\n");

    const template = loadTemplate(configRoot, "ci");

    expect(template.files).toEqual(["ci.yml"]);

    writeFile(
      join(configRoot, "templates", "empty", "template.json"),
      JSON.stringify(
        {
          name: "empty",
          description: "Empty",
          files: ["*.md"],
        },
        null,
        2,
      ) + "\n",
    );

    expect(() => loadTemplate(configRoot, "empty")).toThrowError('No files matched glob "*.md"');
  });
});
