#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
// @ts-expect-error - marked-terminal types are outdated for v7
import { markedTerminal } from "marked-terminal";
import { collectCheckReport } from "./check.js";
import { loadFeatures, loadProjects } from "./config.js";
import { applyTemplateVars } from "./templates.js";

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

  if (!parsed.command || parsed.command === "help") {
    printHelp();
    process.exit(0);
  }
  if (
    parsed.flags.help &&
    parsed.command !== "project" &&
    parsed.command !== "feature" &&
    parsed.command !== "check" &&
    parsed.command !== "features" &&
    parsed.command !== "show"
  ) {
    printHelp();
    process.exit(0);
  }

  switch (parsed.command) {
    case "projects": {
      console.warn("projects is deprecated; use project ls instead.");
      const projects = loadProjects(configRoot);
      if (parsed.flags.json) {
        console.log(JSON.stringify(projects, null, 2));
        break;
      }
      for (const project of projects) {
        console.log(project.name);
        console.log(`  path: ${project.path}`);
        console.log(`  features: ${project.features.join(", ") || "none"}`);
        console.log("");
      }
      break;
    }
    case "project": {
      const subcommand = parsed.positionals[0];
      const args = parsed.positionals.slice(1);

      if (!subcommand || subcommand === "help") {
        printProjectHelp();
        process.exit(0);
      }

      switch (subcommand) {
        case "ls": {
          if (parsed.flags.help) {
            printProjectLsHelp();
            process.exit(0);
          }
          const projects = loadProjects(configRoot);
          if (parsed.flags.json) {
            console.log(JSON.stringify(projects, null, 2));
            break;
          }
          for (const project of projects) {
            console.log(project.name);
            console.log(`  path: ${project.path}`);
            console.log(`  features: ${project.features.join(", ") || "none"}`);
            console.log("");
          }
          break;
        }
        case "add": {
          if (parsed.flags.help) {
            printProjectAddHelp();
            process.exit(0);
          }
          const name = args[0];
          const pathArg = args[1];
          const featureArgs = args.slice(2);
          if (!name || !pathArg || featureArgs.length === 0) {
            console.error("Usage: cookie-manager project add <name> <path> <features>");
            process.exit(2);
          }

          try {
            const projectPath = resolve(process.cwd(), pathArg);
            const featureNames = parseFeatureList(featureArgs);
            ensureFeaturesExist(configRoot, featureNames);

            const projects = loadProjects(configRoot);
            if (projects.some((entry) => entry.name === name)) {
              console.error(`Project already exists: ${name}`);
              process.exit(2);
            }

            const projectsDir = join(configRoot, "projects");
            const projectFile = join(projectsDir, `${name}.json`);
            if (existsSync(projectFile)) {
              console.error(`Project config already exists: ${projectFile}`);
              process.exit(2);
            }
            mkdirSync(projectsDir, { recursive: true });
            writeFileSync(
              projectFile,
              `${JSON.stringify({ name, path: projectPath, features: featureNames }, null, 2)}\n`,
              "utf8",
            );
            console.log(`Added project config: ${projectFile}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(2);
          }
          break;
        }
        case "init": {
          if (parsed.flags.help) {
            printProjectInitHelp();
            process.exit(0);
          }
          const pathArg = args[0];
          const featureArgs = args.slice(1);
          if (!pathArg || featureArgs.length === 0) {
            console.error("Usage: cookie-manager project init <path> <features>");
            process.exit(2);
          }

          try {
            const projectPath = resolve(process.cwd(), pathArg);
            if (existsSync(projectPath)) {
              console.error(`Project directory already exists: ${projectPath}`);
              process.exit(2);
            }

            const featureNames = parseFeatureList(featureArgs);
            const features = ensureFeaturesExist(configRoot, featureNames);
            const renderedTemplates = renderFeatureTemplates({
              configRoot,
              features,
            });
            mkdirSync(projectPath, { recursive: true });
            writeRenderedTemplates({
              projectPath,
              renderedTemplates,
            });
            const projectName = basename(projectPath);
            const projectsDir = join(configRoot, "projects");
            const projectFile = join(projectsDir, `${projectName}.json`);
            if (existsSync(projectFile)) {
              console.error(`Project config already exists: ${projectFile}`);
              process.exit(2);
            }
            mkdirSync(projectsDir, { recursive: true });
            writeFileSync(
              projectFile,
              `${JSON.stringify(
                { name: projectName, path: projectPath, features: featureNames },
                null,
                2,
              )}\n`,
              "utf8",
            );
            console.log(`Initialized project at ${projectPath}`);
            console.log(`Added project config: ${projectFile}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(2);
          }
          break;
        }
        default: {
          console.error(`Unknown project command: ${subcommand}`);
          printHelp();
          process.exit(1);
        }
      }
      break;
    }
    case "features": {
      console.warn("features is deprecated; use feature ls instead.");
      if (parsed.flags.help) {
        printFeatureHelp();
        process.exit(0);
      }
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
    case "feature": {
      const subcommand = parsed.positionals[0];
      const args = parsed.positionals.slice(1);

      if (!subcommand || subcommand === "help") {
        printFeatureHelp();
        process.exit(0);
      }

      switch (subcommand) {
        case "ls": {
          if (parsed.flags.help) {
            printFeatureLsHelp();
            process.exit(0);
          }
          if (args.length > 0) {
            console.error("feature ls does not accept positional arguments.");
            process.exit(2);
          }
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
        case "add": {
          if (parsed.flags.help) {
            printFeatureAddHelp();
            process.exit(0);
          }
          const projectName = args[0];
          const featureName = args[1];
          if (!projectName || !featureName) {
            console.error("Usage: cookie-manager feature add <project> <feature>");
            process.exit(2);
          }
          if (args.length > 2) {
            console.error("feature add accepts only <project> <feature>.");
            process.exit(2);
          }

          try {
            const projects = loadProjects(configRoot);
            const project = projects.find((entry) => entry.name === projectName);
            if (!project) {
              console.error(`Project not found: ${projectName}`);
              process.exit(2);
            }
            const [feature] = ensureFeaturesExist(configRoot, [featureName]);
            if (project.features.includes(featureName)) {
              console.error(`Project ${projectName} already includes feature ${featureName}.`);
              process.exit(2);
            }

            const projectRoot = project.path;
            if (!existsSync(projectRoot)) {
              console.error(`Project path does not exist: ${projectRoot}`);
              process.exit(2);
            }

            const existingFiles = feature.files.filter((filePath) =>
              existsSync(join(projectRoot, filePath)),
            );
            if (existingFiles.length > 0) {
              console.error(
                `Cannot add feature ${featureName}; files already exist:\n${existingFiles
                  .map((filePath) => `- ${filePath}`)
                  .join("\n")}`,
              );
              process.exit(2);
            }

            const projectFile = join(configRoot, "projects", `${project.name}.json`);
            if (!existsSync(projectFile)) {
              console.error(`Project config not found: ${projectFile}`);
              process.exit(2);
            }

            const updatedProject = {
              ...project,
              features: [...project.features, featureName],
            };
            writeFileSync(projectFile, `${JSON.stringify(updatedProject, null, 2)}\n`, "utf8");
            console.log(`Added feature ${featureName} to ${projectName}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(2);
          }
          break;
        }
        case "init": {
          if (parsed.flags.help) {
            printFeatureInitHelp();
            process.exit(0);
          }
          const projectName = args[0];
          const featureName = args[1];
          if (!projectName || !featureName) {
            console.error("Usage: cookie-manager feature init <project> <feature>");
            process.exit(2);
          }
          if (args.length > 2) {
            console.error("feature init accepts only <project> <feature>.");
            process.exit(2);
          }

          try {
            const projects = loadProjects(configRoot);
            const project = projects.find((entry) => entry.name === projectName);
            if (!project) {
              console.error(`Project not found: ${projectName}`);
              process.exit(2);
            }
            const [feature] = ensureFeaturesExist(configRoot, [featureName]);
            if (project.features.includes(featureName)) {
              console.error(`Project ${projectName} already includes feature ${featureName}.`);
              process.exit(2);
            }

            const projectRoot = project.path;
            if (!existsSync(projectRoot)) {
              console.error(`Project path does not exist: ${projectRoot}`);
              process.exit(2);
            }

            const existingFiles = feature.files.filter((filePath) =>
              existsSync(join(projectRoot, filePath)),
            );
            if (existingFiles.length > 0) {
              console.error(
                `Cannot init feature ${featureName}; files already exist:\n${existingFiles
                  .map((filePath) => `- ${filePath}`)
                  .join("\n")}`,
              );
              process.exit(2);
            }

            const renderedTemplates = renderFeatureTemplatesForProject({
              configRoot,
              feature,
              project,
            });
            writeRenderedTemplates({
              projectPath: projectRoot,
              renderedTemplates,
            });

            const projectFile = join(configRoot, "projects", `${project.name}.json`);
            if (!existsSync(projectFile)) {
              console.error(`Project config not found: ${projectFile}`);
              process.exit(2);
            }
            const updatedProject = {
              ...project,
              features: [...project.features, featureName],
            };
            writeFileSync(projectFile, `${JSON.stringify(updatedProject, null, 2)}\n`, "utf8");

            console.log(`Initialized feature ${featureName} in ${projectName}`);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(message);
            process.exit(2);
          }
          break;
        }
        default: {
          console.error(`Unknown feature command: ${subcommand}`);
          printFeatureHelp();
          process.exit(1);
        }
      }
      break;
    }
    case "show": {
      if (parsed.flags.help) {
        printShowHelp();
        process.exit(0);
      }
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
      if (parsed.flags.help) {
        printCheckHelp();
        process.exit(0);
      }
      const featureFlag = parsed.flags.feature;
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

      const projectName = typeof projectFlag === "string" ? projectFlag : undefined;
      const includeDiffs = Boolean(diffFlag);

      let featureNames: string[];
      if (!featureFlag || featureFlag === true) {
        if (projectName) {
          const projects = loadProjects(configRoot);
          const project = projects.find((entry) => entry.name === projectName);
          if (!project) {
            console.error(`Project not found: ${projectName}`);
            process.exit(2);
          }
          featureNames = project.features;
          if (featureNames.length === 0) {
            console.error(`Project ${projectName} has no features to check.`);
            process.exit(2);
          }
        } else {
          featureNames = loadFeatures(configRoot).map((feature) => feature.name);
        }
      } else {
        featureNames = [String(featureFlag)];
      }

      let markdown: string;
      try {
        markdown = featureNames
          .map((featureName) =>
            collectCheckReport({
              configRoot,
              featureName,
              projectName,
              includeDiffs,
            }),
          )
          .join("\n\n---\n\n");
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
  feature ls         List configured features (includes README content)
  feature add        Add a feature to a project
  feature init       Add a feature and copy files into a project
  project ls         List configured projects
  project add        Add a project config
  project init       Create a project directory with feature templates
  show <name>        Print a project configuration
  help               Show this help

Options:
  --config-root PATH Override the config directory (default: ./config)
  --feature NAME     Feature name for check (omit to check all features)
  --project NAME     Limit check to a single project
  --diff             Include per-project diffs between templates and files
  --json             Print JSON output for project ls or feature ls
  --help             Show help
`);
}

function printCheckHelp(): void {
  console.log(`cookie-manager check [options]

Generate the drift report for one or more features.

Options:
  --config-root PATH Override the config directory (default: ./config)
  --feature NAME     Feature name for check (omit to check all features)
  --project NAME     Limit check to a single project
  --diff             Include per-project diffs between templates and files
  --help             Show this help
`);
}

function printFeatureHelp(): void {
  console.log(`cookie-manager feature <command> [options]

Commands:
  ls                 List configured features
  add                Add a feature to a project
  init               Add a feature and copy its files into the project

Run "cookie-manager feature <command> --help" for command-specific options.
`);
}

function printFeatureLsHelp(): void {
  console.log(`cookie-manager feature ls [options]

List configured features and include their README content.

Options:
  --config-root PATH Override the config directory (default: ./config)
  --json             Print JSON output
  --help             Show this help
`);
}

function printFeatureAddHelp(): void {
  console.log(`cookie-manager feature add <project> <feature>

Add a feature to a project config. Fails if any feature files already exist.

Arguments:
  project            Project name from config/projects
  feature            Feature name from config/features

Options:
  --help             Show this help
`);
}

function printFeatureInitHelp(): void {
  console.log(`cookie-manager feature init <project> <feature>

Add a feature to a project config and copy its template files.
Fails if any feature files already exist.

Arguments:
  project            Project name from config/projects
  feature            Feature name from config/features

Options:
  --help             Show this help
`);
}

function printShowHelp(): void {
  console.log(`cookie-manager show <name> [options]

Print a project configuration by name.

Options:
  --config-root PATH Override the config directory (default: ./config)
  --help             Show this help
`);
}

function printProjectHelp(): void {
  console.log(`cookie-manager project <command> [options]

Commands:
  ls                 List configured projects
  add                Add a project config
  init               Create a project directory with feature templates

Run "cookie-manager project <command> --help" for command-specific options.
`);
}

function printProjectLsHelp(): void {
  console.log(`cookie-manager project ls [options]

List configured projects.

Options:
  --json             Print JSON output
  --help             Show this help
`);
}

function printProjectAddHelp(): void {
  console.log(`cookie-manager project add <name> <path> <features>

Add a project config in config/projects/<name>.json.

Arguments:
  name               Project name (used as the config filename)
  path               Project root path (relative to cwd or absolute)
  features           One or more feature names (comma-separated or space-separated)

Options:
  --help             Show this help
`);
}

function printProjectInitHelp(): void {
  console.log(`cookie-manager project init <path> <features>

Create a new project directory, apply feature templates, and add a project config.

Arguments:
  path               Project root path to create (relative to cwd or absolute)
  features           One or more feature names (comma-separated or space-separated)

Options:
  --help             Show this help
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

function parseFeatureList(values: string[]): string[] {
  const names = values.flatMap((value) => value.split(",")).map((value) => value.trim());
  const filtered = names.filter((value) => value.length > 0);
  if (filtered.length === 0) {
    throw new Error("No features provided.");
  }
  return filtered;
}

function ensureFeaturesExist(configRoot: string, featureNames: string[]) {
  const features = loadFeatures(configRoot);
  const featureMap = new Map(features.map((feature) => [feature.name, feature]));
  const missing = featureNames.filter((name) => !featureMap.has(name));
  if (missing.length > 0) {
    throw new Error(`Unknown feature(s): ${missing.join(", ")}`);
  }
  return featureNames.map((name) => featureMap.get(name)!);
}

function renderFeatureTemplates(options: {
  configRoot: string;
  features: ReturnType<typeof ensureFeaturesExist>;
}): { filePath: string; content: string }[] {
  const { configRoot, features } = options;
  const written = new Set<string>();
  const renderedTemplates: { filePath: string; content: string }[] = [];

  for (const feature of features) {
    for (const filePath of feature.files) {
      if (written.has(filePath)) {
        throw new Error(`Duplicate template path across features: ${filePath}`);
      }

      const templatePath = join(configRoot, "features", feature.name, "files", filePath);
      if (!existsSync(templatePath)) {
        throw new Error(`Missing template file for ${feature.name}: ${templatePath}`);
      }
      const templateContent = readFileSync(templatePath, "utf8");
      const rendered = applyTemplateVars(templateContent, undefined, {
        ignoredVariables: feature.ignoredTemplateVariables,
      });
      renderedTemplates.push({ filePath, content: rendered });
      written.add(filePath);
    }
  }

  return renderedTemplates;
}

function writeRenderedTemplates(options: {
  projectPath: string;
  renderedTemplates: { filePath: string; content: string }[];
}): void {
  const { projectPath, renderedTemplates } = options;
  for (const template of renderedTemplates) {
    const outputPath = join(projectPath, template.filePath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, template.content, "utf8");
  }
}

function renderFeatureTemplatesForProject(options: {
  configRoot: string;
  feature: ReturnType<typeof ensureFeaturesExist>[number];
  project: ReturnType<typeof loadProjects>[number];
}): { filePath: string; content: string }[] {
  const { configRoot, feature, project } = options;
  const renderedTemplates: { filePath: string; content: string }[] = [];

  for (const filePath of feature.files) {
    const templatePath = join(configRoot, "features", feature.name, "files", filePath);
    if (!existsSync(templatePath)) {
      throw new Error(`Missing template file for ${feature.name}: ${templatePath}`);
    }
    const templateContent = readFileSync(templatePath, "utf8");
    const rendered = applyTemplateVars(templateContent, project.templateVars, {
      ignoredVariables: feature.ignoredTemplateVariables,
    });
    renderedTemplates.push({ filePath, content: rendered });
  }

  return renderedTemplates;
}
