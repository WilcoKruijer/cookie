# Changesets

This repo uses Changesets to manage versioning and releases for publishable packages.

## Required environment

- `GITHUB_TOKEN` (GitHub Actions secret): Used by `changesets/action` to open PRs or publish.
- `TURBO_TOKEN` (GitHub Actions secret): Used for Turborepo remote caching during release builds.
- `TURBO_TEAM` (GitHub Actions variable): Team slug for the Turborepo remote cache.

## Expected drift (keep concise)

- Config drift is normal when a project needs custom `access`, `fixed`/`linked`, or `ignore` rules.
- README drift is normal when a project keeps the default Changesets README.
- Release workflow drift is normal when a project customizes publish triggers or permissions.
- Removing Changesets entirely is expected for non-publishable projects; remove the feature in
  `config/projects/*.json` and omit the `.changeset` folder.
