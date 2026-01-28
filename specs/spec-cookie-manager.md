# Cookie Manager — Spec

## Decisions

- Feature versions are semantic (`1.2.0`, `2.0.0`), not `v1` labels.
- Feature versions are immutable; any template change requires a new version.
- Feature versions must not be bumped unless at least one file content change exists.
- File ownership is single-owner only; conflicts must be resolved explicitly.
- No interactive mode for now; the CLI is non-interactive by default.
- Project configs are the single source of truth for applied feature versions.
- Missing or invalid project paths are fatal errors.

## Goals

- Provide a single CLI to inspect and sync feature-based repo setup across projects.
- Maintain a feature registry with versioned templates and file ownership.
- Identify drift between a project’s files and the feature templates, including why the drift
  happened (missing file, changed file, or file matches a different feature version).
- Support updating multiple projects in a single run, with clear diffs and conflict handling.
- Keep the configuration and templates in this repo, and include this repo as a managed project.

## Non-goals

- Replacing project-specific build or release logic.
- Auto-generating bespoke project code beyond template-driven files.
- Managing secrets or environment variables.

## References

- Baseline repo setups (fragno, thalo, kc): `specs/references/repo-baseline.md`

## Terminology

- **Feature domain**: A logical area of repo setup (changeset, ci, lint, monorepo, lefthook, ai).
- **Feature version**: A semantic version for a domain template set (e.g., `1.2.0`).
- **Template**: Canonical file content for a feature version.
- **Template vars**: Project-provided values used to replace placeholders in template files.
- **Project config**: Declares which features a repo uses and where it lives on disk.
- **Drift**: A project file differing from its canonical template.
- **Conflict**: Multiple features claim the same file path.

## Repo Layout

- `apps/cookie-manager/`: CLI implementation.
- `config/projects/*.json`: Project configs, one per repo.
- `config/features/<domain>/<version>/feature.json`: Feature metadata.
- `config/features/<domain>/<version>/files/`: Template files for that feature (including JSON merge
  fragments).

## Feature Definition Schema

Each feature version is defined by `feature.json` and templates in `files/`. All JSON configs are
validated with Zod.

```json
{
  "domain": "lint",
  "version": "1.0.0",
  "description": "Linting and formatting configuration.",
  "templateRoot": "config/features/lint/1.0.0/files",
  "changes": {
    "1.1.0": {
      "renames": {
        "old-name.json": "new-name.json"
      },
      "deletes": ["deprecated.json"]
    }
  },
  "files": [".oxlintrc.json", ".prettierignore", "prettier.config.mjs"],
  "fileRules": {
    "scripts/commit-msg": {
      "require": "exists"
    }
  },
  "fileMerge": {
    "json": ["package.json"]
  }
}
```

Rules:

- `files` are repo-root-relative paths.
- The template file must exist under `templateRoot` using the same relative path.
- File ownership is exclusive by default. If two features list the same file, that is a conflict
  (see Conflict Handling).
- `fileRules` can override file requirements. `require: "exists"` means the file must exist in the
  target repo, but its contents are not compared or synced.
- `changes` is keyed by the version in which the rename/delete occurred.
- `changes.renames` maps old paths to new paths for this version.
- `changes.deletes` lists paths removed in this version.
- `fileMerge` is optional and declares files that should be merged rather than overwritten.
- `fileMerge.json` lists repo-root-relative JSON file paths. The merge fragment for each path is
  loaded from the same relative path under `templateRoot`.
- Template files may contain placeholder strings that are replaced with values from the project’s
  `templateVars` map.

### Template string replacement

- Placeholder format: `{{varName}}` (case-sensitive).
- Substitution uses `templateVars` from the project config.
- Missing keys are fatal errors (fail the project validation before any writes).
- Replacement happens before drift detection and before sync writes.

## Project Config Schema

Project configs live in `config/projects/*.json`. All JSON configs are validated with Zod.

```json
{
  "name": "fragno",
  "path": "/Users/wilco/dev/fragno",
  "templateVars": {
    "orgName": "wilco",
    "repoName": "fragno",
    "packageScope": "@wilco"
  },
  "features": {
    "changeset": "1.0.0",
    "ci": "1.0.0",
    "lint": "1.0.0",
    "monorepo": "1.0.0",
    "lefthook": "1.0.0",
    "ai": "1.0.0"
  }
}
```

## Drift Detection

The CLI evaluates each project by feature:

- **Missing**: File is absent in the repo.
- **Mismatch**: File exists but content differs from the template.

For mismatches, the CLI should also check whether the file matches a different version of the same
feature (based on diff against other versions). If it matches, report: “appears to be lint@2.0.0
while project declares lint@1.0.0.”

### Diff-based drift analysis

The CLI treats the declared feature version as the base. Drift is based on a direct diff between the
template at the declared version (after template var substitution) and the current project file.

## Conflict Handling

- Default rule: a file is owned by exactly one feature.
- If two features claim the same file, `status` must report a conflict and `sync` must refuse to
  apply changes until resolved.
- Conflict resolution can be handled by:
  - Adjusting feature definitions to remove overlap.
  - Adding a `featureOverrides` entry for that file (ownership or override strategy).

## Sync / Update Behavior

- `sync` applies templates into the project (create/update files).
- `--dry-run` is the default and must show intended changes without writing.
- `--apply` writes the files.
- `--diff` shows unified diffs for each file.
- `--project <name>` limits scope; default is all projects.
- When updating to a newer feature version, `sync` must use a standard three-way merge tool (e.g.,
  `git merge-file`) with:
  - base: template at current declared version
  - local: target repo file
  - remote: template at new version Conflicts are surfaced based on the merge strategy.
- Sync must be atomic per project: validate all changes (including merges, renames, and deletes)
  before writing any files. If any file would conflict or fail validation, no changes are applied.

### File merge (json)

- If a feature declares `fileMerge.json`, merge the fragment into the target JSON file.
- The merge is deep and deterministic; later features in config order win on conflicts.
- Arrays are replaced, not concatenated.
- A missing target JSON file is treated as `{}`.
- The merged result is written as part of `sync` and checked during drift detection.

### Merge strategies

- **none (default)**: if a three-way merge would conflict, stop and error. Output a hint to rerun
  with `--merge=markers|keep-local|overwrite`.
- **markers**: write standard conflict markers into the file for manual resolution.
- **keep-local**: on conflict, keep the local file and skip applying the new template.
- **overwrite**: on conflict, overwrite the local file with the new template.

## CLI Commands

- `cookie-manager projects` — list configured projects.
- `cookie-manager show <name>` — print project config.
- `cookie-manager status [--project <name>] [--strict] [--json]` — show drift and conflicts.
- `cookie-manager sync [--project <name>] [--dry-run|--apply] [--diff]` — update files from
  templates.
- `cookie-manager explain <name> <file>` — show which feature owns a file and why it is out of sync.
- `cookie-manager collect [--project <name>] [--diff]` — output a Markdown report of drift across
  projects, including diffs.

## Output & Logging

- Default output is human-readable, one project per block.
- `--json` produces machine-readable output for CI.
- Exit codes:
  - `0`: no drift or successful sync
  - `1`: drift or conflicts found
  - `2`: fatal error (invalid config, missing templates)
