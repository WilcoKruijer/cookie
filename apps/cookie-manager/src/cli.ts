#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjects } from "./config.js";
import { collectMarkdownReport } from "./collect.js";
import { collectStatusReport, type ProjectStatus } from "./status.js";

type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

const DEFAULT_CONFIG_DIR = "config";

const argv = process.argv.slice(2);
const parsed = parseArgs(argv);
const repoRoot =
  findRepoRoot(process.cwd()) ??
  findRepoRoot(dirname(fileURLToPath(import.meta.url))) ??
  process.cwd();
const configRoot = resolve(repoRoot, String(parsed.flags["config-root"] || DEFAULT_CONFIG_DIR));

if (!parsed.command || parsed.flags.help || parsed.command === "help") {
  printHelp();
  process.exit(0);
}

switch (parsed.command) {
  case "projects": {
    const projects = loadProjects(configRoot);
    if (parsed.flags.json) {
      console.log(JSON.stringify(projects, null, 2));
      break;
    }
    for (const project of projects) {
      console.log(project.name);
    }
    break;
  }
  case "show": {
    const name = parsed.positionals[0];
    if (!name) {
      console.error("Missing project name.");
      process.exit(1);
    }
    const projects = loadProjects(configRoot);
    const project = projects.find((entry) => entry.name === name);
    if (!project) {
      console.error(`Project not found: ${name}`);
      process.exit(1);
    }
    console.log(JSON.stringify(project, null, 2));
    break;
  }
  case "status": {
    const projectFlag = parsed.flags.project;
    if (projectFlag === true) {
      console.error("Missing project name for --project.");
      process.exit(2);
    }
    const projectName = typeof projectFlag === "string" ? projectFlag : undefined;
    let report;
    try {
      report = collectStatusReport({ repoRoot, configRoot, projectName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(2);
    }
    if (report.projects.length === 0) {
      console.log("No projects configured.");
      process.exit(0);
    }
    if (parsed.flags.json) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.hasConflicts || report.hasDrift ? 1 : 0);
    }
    for (const project of report.projects) {
      printProjectStatus(project);
    }
    process.exit(report.hasConflicts || report.hasDrift ? 1 : 0);
  }
  case "collect": {
    const projectFlag = parsed.flags.project;
    if (projectFlag === true) {
      console.error("Missing project name for --project.");
      process.exit(2);
    }
    const projectName = typeof projectFlag === "string" ? projectFlag : undefined;
    let report;
    try {
      report = collectStatusReport({ repoRoot, configRoot, projectName });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(2);
    }
    const markdown = collectMarkdownReport({
      repoRoot,
      configRoot,
      projectName,
      includeDiffs: Boolean(parsed.flags.diff),
      report,
    });
    console.log(markdown);
    process.exit(report.hasConflicts || report.hasDrift ? 1 : 0);
  }
  default: {
    console.error(`Unknown command: ${parsed.command}`);
    printHelp();
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`cookie-manager <command> [options]

Commands:
  projects           List configured projects
  show <name>        Print a project configuration
  status             Show drift and conflicts
  collect            Report drift as Markdown
  help               Show this help

Options:
  --config-root PATH Override the config directory (default: ./config)
  --json             Print JSON output where available
  --project NAME     Limit status/sync/collect to a single project
  --diff             Include diffs for mismatched/missing files
  --strict           Fail on any warning-level status
  --help             Show help
`);
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command: string | null = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }

    if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags };
}

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    const workspacePath = join(current, "pnpm-workspace.yaml");
    const gitPath = join(current, ".git");
    if (existsSync(workspacePath) || existsSync(gitPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function printProjectStatus(project: ProjectStatus): void {
  console.log(`${project.name} (${project.path})`);
  if (project.ok) {
    console.log("  No drift or conflicts detected.");
    console.log("");
    return;
  }
  if (project.conflicts.length > 0) {
    console.log("  Conflicts:");
    for (const conflict of project.conflicts) {
      const detail = conflict.detail ? ` (${conflict.detail})` : "";
      console.log(
        `    - ${conflict.path} [${conflict.type}] ${conflict.owners.join(", ")}${detail}`,
      );
    }
  }
  if (project.missing.length > 0) {
    console.log("  Missing:");
    for (const entry of project.missing) {
      const detail = entry.detail ? ` (${entry.detail})` : "";
      console.log(`    - ${entry.path} (${entry.feature})${detail}`);
    }
  }
  if (project.mismatches.length > 0) {
    console.log("  Mismatch:");
    for (const entry of project.mismatches) {
      const matches = entry.matches ? ` matches ${entry.matches}` : "";
      const detail = entry.detail ? ` (${entry.detail})` : "";
      console.log(`    - ${entry.path} (${entry.feature})${matches}${detail}`);
    }
  }
  console.log("");
}
