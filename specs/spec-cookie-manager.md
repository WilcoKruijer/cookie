# Cookie Manager — Spec

## Decisions

- Features are unversioned. Each feature has one canonical set of template files.
- Templates are unversioned and applied once; they are not checked for drift after application.
- `check` is read-only. Project initialization commands may write new configs and files.
- `check` is the primary workflow command and replaces `status`, `sync`, `explain`, and `collect`.
- `project ls` and `show` are optional informational commands; they do not alter any state.
- Feature templates are 1:1 file snapshots. There are no merge fragments, renames, deletes, or
  special file types.
- Feature membership is declared in each project config. `check` only inspects projects that declare
  the feature (unless a `--project` filter is used).
- Template placeholders are supported via simple string substitution using per-project
  `templateVars`. Missing template vars are fatal errors.
- Missing template files are reported in the Markdown report and should be added to the feature.
- Missing project files are reported in the Markdown report.

## Goals

- Provide a single CLI command to collect feature template files and the corresponding project files
  across all configured projects.
- Emit a Markdown report that is human-readable and ready for LLM review.
- Include an embedded LLM prompt that instructs an LLM to assess drift and suggest updates for both
  templates and projects.
- Support applying one-time templates to projects with the same template var rendering rules as
  features.

## Non-goals

- Writing or updating files in existing project repos outside explicit init/apply commands.
- Ongoing drift detection or reconciliation for templates after they are applied.
- Automated drift classification, merge strategies, or conflict resolution.
- Versioning or migration logic for feature templates.

## References

- Baseline repo setups (fragno, thalo, kc): `specs/references/repo-baseline.md`

## Terminology

- **Feature**: A named bundle of repo setup files (e.g., `lint`, `turbo`, `changeset`).
- **Feature template**: Canonical file content stored in this repo for a feature.
- **Template**: A one-time bundle of files applied to a project (not kept in sync).
- **Project**: A repo on disk that declares which features it uses.
- **Report**: The Markdown output produced by `check` containing templates, project files, and an
  LLM prompt.

## Repo Layout

- `apps/cookie-manager/`: CLI implementation.
- `config/projects/*.json`: Project configs, one per repo.
- `config/features/<feature>/feature.json`: Feature metadata.
- `config/features/<feature>/files/`: Template files for that feature.
- `config/templates/<template>/template.json`: Template metadata.
- `config/templates/<template>/files/`: Template files for that template.

## Feature Definition Schema

Each feature is defined by `feature.json` and a `files/` directory of template files.

```json
{
  "name": "lint",
  "description": "Linting and formatting configuration.",
  "files": [".prettierignore", "prettier.config.mjs", "lefthook.yml"]
}
```

Rules:

- `files` are repo-root-relative paths.
- For each `files` entry, the template file must exist at `config/features/<feature>/files/<path>`.
- The order of `files` is preserved in the report.
- `files` entries may include glob patterns. Globs are resolved against
  `config/features/<feature>/files/` and expanded to matching files. Expanded paths are
  repo-root-relative in the report.

## Project Config Schema

Project configs live in `config/projects/*.json`.

```json
{
  "name": "fragno",
  "path": "/Users/wilco/dev/fragno",
  "templateVars": {
    "orgName": "wilco",
    "repoName": "fragno",
    "packageScope": "@wilco"
  },
  "features": ["changeset", "lint", "turbo", "lefthook", "ai"],
  "templates": ["github-actions", "eslint-react"]
}
```

Rules:

- `features` is a list of feature names.
- `templates` is an optional list of templates that have been applied to the project.
- `templateVars` is optional but required if a template references `{{varName}}` placeholders.
- Missing or invalid project paths are fatal errors.

## Template Definition Schema

Each template is defined by `template.json` and a `files/` directory of template files.

```json
{
  "name": "github-actions",
  "description": "Reusable CI workflows for JS repos.",
  "files": [".github/workflows/ci.yml", ".github/dependabot.yml"]
}
```

Rules:

- `files` are repo-root-relative paths.
- For each `files` entry, the template file must exist at
  `config/templates/<template>/files/<path>`.
- The order of `files` is preserved when applying the template.
- `files` entries may include glob patterns. Globs are resolved against
  `config/templates/<template>/files/` and expanded to matching files. Expanded paths are
  repo-root-relative when applying the template.

## Template Rendering

- Placeholder format: `{{varName}}` (case-sensitive).
- Substitution uses `templateVars` from the project config.
- Replacement happens when preparing the per-project template content in the report and when
  applying templates.
- Missing keys are fatal errors for that project.

## CLI Commands

- `cookie-manager check [--feature <name>] [--project <name>] [--diff]`
- `cookie-manager feature ls` (optional utility) — list configured features.
- `cookie-manager feature add <project> <feature>` — add a feature to a project config.
- `cookie-manager feature init <project> <feature>` — add a feature, copy templates, and update the
  project config.
- `cookie-manager template ls` — list configured templates.
- `cookie-manager template apply <project> <template>` — render and copy template files into a
  project, then record the template in the project config.
- `cookie-manager project ls` (optional utility) — list configured projects.
- `cookie-manager project add <name> <path> <features>` — add a project config.
- `cookie-manager project init <path> <features>` — create a project directory with feature
  templates and add a project config.
- `cookie-manager show <name>` (optional utility) — print project config.

## `check` Behavior

Inputs:

- `--feature <name>` limits the report to one feature. If omitted, check all features.
- `--project <name>` limits the report to one project. If combined with no `--feature`, only the
  project's features are checked.
- `--diff` includes per-project diffs between rendered templates and project files.

Processing steps:

1. Load all project configs.
2. Load the target feature definition and template files.
3. Select projects that declare the feature (and match `--project` if provided).
4. For each template file:
   - Read the raw template from `config/features/<feature>/files/<path>`.
   - For each project, render the template with that project's `templateVars`.
   - If the template file is missing, note it in the report and render a `MISSING` marker for all
     projects.
5. For each project file path:
   - Read the file from the project repo if it exists.
   - If missing, note it in the report.
6. Emit the Markdown report and include the LLM prompt section.
   - If stdout is a TTY, render Markdown for terminal display.
   - If stdout is not a TTY (piped/redirected), emit raw Markdown.
7. When `--diff` is set, include a rendered diff block for each project file.

Templates are ignored by `check`. Only feature templates and project feature files appear in the
report.

## `template apply` Behavior

Inputs:

- `<project>` is the project config name.
- `<template>` is the template name.

Processing steps:

1. Load the project config and template definition.
2. Resolve and read each template file from `config/templates/<template>/files/<path>`.
3. Render each template file using the project `templateVars`.
4. Validate that none of the target paths already exist in the project repo.
5. Write the rendered files to the project repo in the order listed by `files`.
6. Add the template name to the project config `templates` list (preserve existing order).

Errors:

- Missing template files or missing template vars are fatal errors.
- If any target path already exists, the command fails without writing any files.

## Report Format

The report is a single Markdown document per feature. When `--feature` is omitted, the CLI emits
multiple feature reports separated by a Markdown horizontal rule (`---`).

Each per-feature report contains these sections in this order:

1. Title and metadata (feature name, generation timestamp, list of projects).
2. `## Template Files` section with one subsection per template file.
3. `## Project: <name>` sections, one per project, in config order.
4. `## LLM Prompt` section containing the prompt in a fenced code block.

Template file blocks:

- Each template file subsection includes:
  - The file path.
  - The raw template content (as stored in this repo), or a clear `MISSING` marker if the template
    file is absent.

Project file blocks:

- Each project section includes, for each feature file in order:
  - The file path.
  - The rendered template content for that project (or a clear `MISSING` marker if the template file
    is absent).
  - The project file content (or a clear `MISSING` marker if not present).

Code fences:

- Use fenced code blocks with a `text` info string by default.
- If a language is obvious from the extension (e.g., `.json`, `.yml`, `.ts`), the CLI may use that
  language tag instead of `text`.

## LLM Prompt (embedded in report)

The report must include the following prompt (filled with the feature name):

```
You are reviewing drift for the feature "<feature>".

You are given:
- Canonical template files.
- Per-project rendered templates.
- Per-project current files (or MISSING markers).

Task:
1. For each file, compare the rendered template to the project file and summarize drift.
2. Decide whether the best fix is to update the template, update one or more projects, or both.
3. Propose template updates when multiple projects share improvements or the template is outdated.
4. Propose project updates when a project should align with the template.
5. Present all suggestions in clear Markdown with sections:
   - Summary
   - Suggested Template Updates (grouped by file path)
   - Suggested Project Updates (grouped by project, then file path)
6. If a template file is missing, recommend what content should be added.
7. If a project file is missing, recommend whether it should be created from the template or
   removed from the feature.

Do not edit files directly. Provide recommendations only.
```

## Output & Logging

- Default output is the Markdown report to stdout.
- When stdout is a TTY, render Markdown for terminal display.
- When stdout is not a TTY, emit raw Markdown (for piping/redirects).
- Exit codes:
  - `0`: report generated successfully
  - `2`: fatal error (invalid config, missing template vars)
