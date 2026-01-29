#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
// @ts-expect-error - marked-terminal types are outdated for v7
import { markedTerminal } from "marked-terminal";
import { collectCheckReport } from "./check.js";
import { loadFeatures, loadProjects } from "./config.js";

type ParsedArgs = {
  command: string | null;
  positionals: string[];
  flags: Record<string, string | boolean>;
};

const DEFAULT_CONFIG_DIR = "config";
const MARKDOWN_RENDER_ENABLED = process.stdout.isTTY;

marked.use(markedTerminal());

export function run(argv: string[] = process.argv.slice(2)): void {
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
    case "features": {
      const features = loadFeatures(configRoot).map((feature) => {
        const readmePath = join(configRoot, "features", feature.name, "README.md");
        const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null;
        return { ...feature, readme };
      });
      if (parsed.flags.json) {
        console.log(JSON.stringify(features, null, 2));
        break;
      }
      for (const feature of features) {
        console.log(feature.name);
        console.log(`  ${feature.description}`);
        console.log(`  files: ${feature.files.join(", ") || "none"}`);
        if (feature.readme) {
          console.log("  readme:");
          for (const line of feature.readme.trimEnd().split("\n")) {
            console.log(`    ${line}`);
          }
        } else {
          console.log("  readme: (missing)");
        }
        console.log("");
      }
      break;
    }
    case "show": {
      const name = parsed.positionals[0];
      if (!name) {
        console.error("Missing project name.");
        process.exit(2);
      }
      const projects = loadProjects(configRoot);
      const project = projects.find((entry) => entry.name === name);
      if (!project) {
        console.error(`Project not found: ${name}`);
        process.exit(2);
      }
      console.log(JSON.stringify(project, null, 2));
      break;
    }
    case "check": {
      const featureFlag = parsed.flags.feature;
      if (!featureFlag || featureFlag === true) {
        console.error("Missing feature name for --feature.");
        process.exit(2);
      }
      const projectFlag = parsed.flags.project;
      if (projectFlag === true) {
        console.error("Missing project name for --project.");
        process.exit(2);
      }
      const diffFlag = parsed.flags.diff;
      if (diffFlag === true) {
        // ok, flag form
      }
      if (parsed.flags.output) {
        console.error("--output is no longer supported. Pipe stdout to a file instead.");
        process.exit(2);
      }
      if (parsed.flags.json) {
        console.error("--json is not supported for check.");
        process.exit(2);
      }

      const featureName = String(featureFlag);
      const projectName = typeof projectFlag === "string" ? projectFlag : undefined;

      let markdown: string;
      try {
        markdown = collectCheckReport({
          configRoot,
          featureName,
          projectName,
          includeDiffs: Boolean(diffFlag),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(2);
      }

      const output = MARKDOWN_RENDER_ENABLED ? marked.parse(markdown) : markdown;
      console.log(output);
      break;
    }
    default: {
      console.error(`Unknown command: ${parsed.command}`);
      printHelp();
      process.exit(1);
    }
  }
}

if (import.meta.main) {
  run();
}

function printHelp(): void {
  console.log(`cookie-manager <command> [options]

Commands:
  check              Generate the drift report for a feature
  features           List configured features (includes README content)
  projects           List configured projects
  show <name>        Print a project configuration
  help               Show this help

Options:
  --config-root PATH Override the config directory (default: ./config)
  --feature NAME     Feature name for check
  --project NAME     Limit check to a single project
  --diff             Include per-project diffs between templates and files
  --json             Print JSON output for projects
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
