#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjects } from "./config.js";
import { collectMarkdownReport } from "./collect.js";
import { collectExplainReport, type ExplainReport } from "./explain.js";
import { collectStatusReport, type ProjectStatus } from "./status.js";
import {
  applySyncReport,
  collectSyncReport,
  type MergeStrategy,
  type SyncProjectReport,
  type SyncReport,
} from "./sync.js";

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
  case "explain": {
    const name = parsed.positionals[0];
    const filePath = parsed.positionals[1];
    if (!name) {
      console.error("Missing project name.");
      process.exit(1);
    }
    if (!filePath) {
      console.error("Missing file path.");
      process.exit(1);
    }
    let report;
    try {
      report = collectExplainReport({
        repoRoot,
        configRoot,
        projectName: name,
        filePath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(2);
    }
    printExplainReport(report);
    const exitCode =
      report.status === "missing" || report.status === "mismatch" || report.status === "conflict"
        ? 1
        : 0;
    process.exit(exitCode);
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
  case "sync": {
    const projectFlag = parsed.flags.project;
    if (projectFlag === true) {
      console.error("Missing project name for --project.");
      process.exit(2);
    }
    const projectName = typeof projectFlag === "string" ? projectFlag : undefined;
    if (parsed.flags.apply && parsed.flags["dry-run"]) {
      console.error("Use either --apply or --dry-run, not both.");
      process.exit(2);
    }
    const mergeFlag = parsed.flags.merge;
    if (mergeFlag === true) {
      console.error("Missing strategy for --merge.");
      process.exit(2);
    }
    const mergeStrategy = parseMergeStrategy(mergeFlag);
    if (!mergeStrategy) {
      console.error(`Invalid merge strategy: ${mergeFlag}`);
      process.exit(2);
    }

    let report: SyncReport;
    try {
      report = collectSyncReport({
        repoRoot,
        configRoot,
        projectName,
        includeDiffs: Boolean(parsed.flags.diff),
        mergeStrategy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exit(2);
    }

    printSyncReport(report, Boolean(parsed.flags.diff));

    if (parsed.flags.apply) {
      applySyncReport(report);
    }

    const hasErrors = report.projects.some((project) => project.errors.length > 0);
    const exitCode =
      report.hasConflicts || hasErrors || (!parsed.flags.apply && report.hasChanges) ? 1 : 0;
    process.exit(exitCode);
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
  explain <name> <file> Show ownership and drift reasons for a file
  collect            Report drift as Markdown
  sync               Sync project files from templates
  help               Show this help

Options:
  --config-root PATH Override the config directory (default: ./config)
  --json             Print JSON output where available
  --project NAME     Limit status/sync/collect to a single project
  --diff             Include diffs for mismatched/missing files
  --apply            Write changes during sync (default: dry-run)
  --dry-run          Show planned sync changes without writing
  --merge STRATEGY   Merge strategy: none, markers, keep-local, overwrite
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

function printExplainReport(report: ExplainReport): void {
  console.log(`${report.project.name} (${report.project.path})`);
  console.log(`File: ${report.path}`);
  console.log(`Owners: ${report.owners.length > 0 ? report.owners.join(", ") : "unmanaged"}`);

  if (report.ownershipType !== "unknown") {
    const label =
      report.ownershipType === "json-merge"
        ? "json-merge"
        : report.ownershipType === "rule"
          ? "required"
          : "template";
    console.log(`Ownership type: ${label}`);
  }

  if (report.status === "conflict") {
    console.log("Status: conflict");
    for (const conflict of report.conflicts) {
      const detail = conflict.detail ? ` (${conflict.detail})` : "";
      console.log(`  - ${conflict.path} [${conflict.type}] ${conflict.owners.join(", ")}${detail}`);
    }
    console.log("");
    return;
  }

  if (report.status === "missing") {
    const detail = report.detail ? ` (${report.detail})` : "";
    console.log(`Status: missing${detail}`);
    console.log("");
    return;
  }

  if (report.status === "mismatch") {
    const matches = report.matches ? ` matches ${report.matches}` : "";
    const detail = report.detail ? ` (${report.detail})` : "";
    console.log(`Status: mismatch${matches}${detail}`);
    console.log("");
    return;
  }

  if (report.status === "unmanaged") {
    const note = report.fileExists ? "file exists" : "file missing";
    console.log(`Status: unmanaged (${note})`);
    console.log("");
    return;
  }

  if (report.ownershipType === "json-merge") {
    console.log("Status: ok (matches merged JSON)");
  } else if (report.ownershipType === "rule") {
    console.log("Status: ok (required file exists)");
  } else {
    console.log("Status: ok (matches template)");
  }
  console.log("");
}

function printSyncReport(report: SyncReport, includeDiffs: boolean): void {
  for (const project of report.projects) {
    printProjectSync(project, includeDiffs);
  }
}

function printProjectSync(project: SyncProjectReport, includeDiffs: boolean): void {
  console.log(`${project.name} (${project.path})`);

  if (project.conflicts.length > 0) {
    console.log("  Conflicts:");
    for (const conflict of project.conflicts) {
      const owners = conflict.owners ? ` ${conflict.owners.join(", ")}` : "";
      const detail = conflict.detail ? ` (${conflict.detail})` : "";
      const resolution = conflict.resolution ? ` [${conflict.resolution}]` : "";
      console.log(`    - ${conflict.path} [${conflict.type}]${owners}${detail}${resolution}`);
    }
  }

  if (project.errors.length > 0) {
    console.log("  Errors:");
    for (const error of project.errors) {
      console.log(`    - ${error}`);
    }
  }

  if (project.actions.length === 0) {
    if (project.conflicts.length === 0 && project.errors.length === 0) {
      console.log("  No changes to apply.");
    }
    console.log("");
    return;
  }

  console.log("  Changes:");
  for (const action of project.actions) {
    if (action.kind === "write") {
      console.log(`    - write ${action.path} (${action.source})`);
      if (includeDiffs && action.diff) {
        console.log("");
        console.log(`Diff for ${action.path}:`);
        console.log("```diff");
        console.log(action.diff.trimEnd());
        console.log("```");
      }
      continue;
    }
    if (action.kind === "delete") {
      console.log(`    - delete ${action.path}`);
      continue;
    }
    console.log(`    - rename ${action.from} -> ${action.to}`);
  }
  console.log("");
}

function parseMergeStrategy(flag: string | boolean | undefined): MergeStrategy | null {
  if (!flag || flag === true) {
    return "none";
  }
  if (flag === "none" || flag === "markers" || flag === "keep-local" || flag === "overwrite") {
    return flag;
  }
  return null;
}
