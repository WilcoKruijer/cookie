import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTemplate } from "../config.js";
import { renderTemplateFiles } from "../templates.js";

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function createWorkspace(): { repoRoot: string; configRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "cookie-templates-"));
  const configRoot = join(repoRoot, "config");
  return { repoRoot, configRoot };
}

describe("renderTemplateFiles", () => {
  it("renders template files with templateVars in order", () => {
    const { configRoot } = createWorkspace();

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

    writeFile(join(configRoot, "templates", "ci", "files", "alpha.txt"), "Hello {{name}}\n");
    writeFile(join(configRoot, "templates", "ci", "files", "beta.txt"), "Static\n");

    const template = loadTemplate(configRoot, "ci");
    const rendered = renderTemplateFiles({
      configRoot,
      template,
      templateVars: { name: "Cookie" },
    });

    expect(rendered).toEqual([
      { filePath: "alpha.txt", content: "Hello Cookie\n" },
      { filePath: "beta.txt", content: "Static\n" },
    ]);
  });

  it("throws when a template var is missing", () => {
    const { configRoot } = createWorkspace();

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

    const template = loadTemplate(configRoot, "ci");

    expect(() =>
      renderTemplateFiles({
        configRoot,
        template,
      }),
    ).toThrowError("Missing template var: name");
  });

  it("throws when a template file is missing", () => {
    const { configRoot } = createWorkspace();

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

    const template = loadTemplate(configRoot, "ci");

    expect(() =>
      renderTemplateFiles({
        configRoot,
        template,
      }),
    ).toThrowError("Missing template file for ci:");
  });
});
