import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadFeatures, loadProjects } from "../config.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const configRoot = join(repoRoot, "config");

describe("config loaders", () => {
  it("loads project configs from repo config", () => {
    const projects = loadProjects(configRoot);
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some((project) => project.name === "cookie")).toBe(true);
  });

  it("loads feature definitions from repo config", () => {
    const features = loadFeatures(configRoot);
    expect(features.length).toBeGreaterThan(0);
    expect(features.some((feature) => feature.domain === "lint")).toBe(true);
  });

  it("throws on invalid project config", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "cookie-config-"));
    const projectsDir = join(tempRoot, "projects");
    mkdirSync(projectsDir, { recursive: true });
    writeFileSync(join(projectsDir, "bad.json"), JSON.stringify({ name: "bad" }), "utf8");
    expect(() => loadProjects(tempRoot)).toThrow(/Invalid config/);
  });
});
