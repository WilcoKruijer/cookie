# Cookie

Cookie is a monorepo that houses the Cookie Manager CLI. The CLI enforces standard setup across
related repos by feature domain (changeset, lint, turbo, lefthook, ai).

## Quick start

```bash
pnpm install
pnpm exec cookie-manager --help
```

## CLI examples

```bash
# List configured projects
pnpm exec cookie-manager project ls

# Show a single project config
pnpm exec cookie-manager show fragno

# Generate a drift report for one feature across all projects
pnpm exec cookie-manager check --feature lint

# Include diffs between rendered templates and project files
pnpm exec cookie-manager check --feature lint --diff

# List configured templates
pnpm exec cookie-manager template ls

# Apply a template to a project
pnpm exec cookie-manager template apply fragno github-actions

# Limit the report to one project and write to a file
pnpm exec cookie-manager check --feature lint --project fragno > report.md
```

## Features

Features are the core building blocks for enforcing shared setup across projects. Each feature is
defined under `config/features/<feature>/feature.json` and can include template files, symlinks,
template-variable rules, and documentation.

### Feature definition

`feature.json` supports:

- `name`: feature name (must match the directory name).
- `description`: short summary used by `feature ls`.
- `files`: list of template file paths under `config/features/<feature>/files`.
  - Supports glob patterns; these are expanded when loading configs.
  - Globs that match nothing are allowed (useful for conditional files).
- `links`: optional list of symlinks to create in projects.
  - `path`: where the symlink should live in the project.
  - `target`: the symlink target (stored as provided, normalized for comparison).
  - `type`: optional `"file"` or `"dir"` to hint symlink creation.
- `ignoredTemplateVariables`: optional list of template variables to ignore during rendering.

### Feature README

If `config/features/<feature>/README.md` exists, it is displayed at the top of drift reports to
provide context and recommendations for that feature.

### Feature commands

- `feature ls`: lists configured features, their files, and their link paths.
- `feature add <project> <feature>`: adds the feature to a project config (no file writes).
  - Fails if any feature file or link path already exists in the project.
- `feature init <project> <feature>`: adds the feature and writes files/links into the project.
  - Renders template variables using the project’s `templateVars`.
  - Fails if any feature file or link path already exists in the project.

### Drift checking

`cookie-manager check` compares feature templates to project files and reports drift.

- Template files are rendered with project `templateVars` before comparison.
- If `--diff` is passed, the report includes a rendered diff per file.
- Symlink status is reported separately:
  - `OK` when the project symlink target matches the feature definition.
  - `MISSING` when no path exists.
  - `NOT_A_SYMLINK` when a real file/dir exists instead.
  - `TARGET_MISMATCH` when the link target differs (normalized comparison).

## Exit codes

- `0`: report generated successfully
- `2`: fatal error (invalid config, missing template vars)
