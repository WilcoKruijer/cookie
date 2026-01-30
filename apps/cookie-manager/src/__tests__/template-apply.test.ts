import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTemplateToProject } from "../template-apply.js";

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createWorkspace(): { repoRoot: string; configRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "cookie-template-apply-"));
  const configRoot = join(repoRoot, "config");
  return { repoRoot, configRoot };
}

describe("applyTemplateToProject", () => {
  it("renders and writes template files, then updates project config", () => {
    const { repoRoot, configRoot } = createWorkspace();
    const projectRoot = join(repoRoot, "projects", "alpha");

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: projectRoot,
          features: ["lint"],
          templates: ["base"],
          templateVars: { name: "Cookie" },
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(
      join(configRoot, "templates", "ci", "template.json"),
      JSON.stringify(
        {
          name: "ci",
          description: "CI templates",
          files: ["alpha.txt", "nested/beta.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "templates", "ci", "files", "alpha.txt"), "Hello {{name}}\n");
    writeFile(join(configRoot, "templates", "ci", "files", "nested", "beta.txt"), "Static\n");

    mkdirSync(projectRoot, { recursive: true });

    applyTemplateToProject({
      configRoot,
      projectName: "alpha",
      templateName: "ci",
    });

    expect(readFileSync(join(projectRoot, "alpha.txt"), "utf8")).toBe("Hello Cookie\n");
    expect(readFileSync(join(projectRoot, "nested", "beta.txt"), "utf8")).toBe("Static\n");

    const updatedProject = JSON.parse(
      readFileSync(join(configRoot, "projects", "alpha.json"), "utf8"),
    ) as { templates: string[] };
    expect(updatedProject.templates).toEqual(["base", "ci"]);
  });

  it("fails when a template var is missing", () => {
    const { repoRoot, configRoot } = createWorkspace();
    const projectRoot = join(repoRoot, "projects", "alpha");

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: projectRoot,
          features: [],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(
      join(configRoot, "templates", "ci", "template.json"),
      JSON.stringify(
        {
          name: "ci",
          description: "CI templates",
          files: ["alpha.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "templates", "ci", "files", "alpha.txt"), "Hello {{name}}\n");
    mkdirSync(projectRoot, { recursive: true });

    expect(() =>
      applyTemplateToProject({
        configRoot,
        projectName: "alpha",
        templateName: "ci",
      }),
    ).toThrowError("Missing template var: name");

    expect(existsSync(join(projectRoot, "alpha.txt"))).toBe(false);
  });

  it("fails when a template file is missing", () => {
    const { repoRoot, configRoot } = createWorkspace();
    const projectRoot = join(repoRoot, "projects", "alpha");

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: projectRoot,
          features: [],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(
      join(configRoot, "templates", "ci", "template.json"),
      JSON.stringify(
        {
          name: "ci",
          description: "CI templates",
          files: ["missing.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    mkdirSync(projectRoot, { recursive: true });

    expect(() =>
      applyTemplateToProject({
        configRoot,
        projectName: "alpha",
        templateName: "ci",
      }),
    ).toThrowError("Missing template file for ci:");
  });

  it("fails when any target path already exists", () => {
    const { repoRoot, configRoot } = createWorkspace();
    const projectRoot = join(repoRoot, "projects", "alpha");

    writeFile(
      join(configRoot, "projects", "alpha.json"),
      JSON.stringify(
        {
          name: "alpha",
          path: projectRoot,
          features: [],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(
      join(configRoot, "templates", "ci", "template.json"),
      JSON.stringify(
        {
          name: "ci",
          description: "CI templates",
          files: ["alpha.txt", "beta.txt"],
        },
        null,
        2,
      ) + "\n",
    );

    writeFile(join(configRoot, "templates", "ci", "files", "alpha.txt"), "Hello\n");
    writeFile(join(configRoot, "templates", "ci", "files", "beta.txt"), "Second\n");

    writeFile(join(projectRoot, "alpha.txt"), "Existing\n");

    expect(() =>
      applyTemplateToProject({
        configRoot,
        projectName: "alpha",
        templateName: "ci",
      }),
    ).toThrowError("Cannot apply template ci; files already exist:");

    expect(existsSync(join(projectRoot, "beta.txt"))).toBe(false);
    expect(readFileSync(join(projectRoot, "alpha.txt"), "utf8")).toBe("Existing\n");
  });
});
