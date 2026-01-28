# Cookie Manager — Implementation Plan

- [x] Implement config loaders for `config/projects` and `config/features` with Zod schema
      validation (Spec: Project Config Schema, Feature Definition Schema).
- [x] Support feature-level JSON contributions to `package.json` with a deterministic merge strategy
      and conflict reporting (Spec: Feature Definition Schema, Conflict Handling).
- [x] Add template resolution helpers that map `feature.json` to `files/` content and apply
      rename/delete metadata (Spec: Feature Definition Schema, Drift Detection).
- [x] Allow feature files to include template strings that resolve from per-project config values
      (Spec: Project Config Schema, Feature Definition Schema).
- [x] Implement `status` command to report missing/mismatch/conflict states per project (Spec: Drift
      Detection, Conflict Handling, CLI Commands).
- [ ] Implement `collect` command to emit a Markdown report with per-project drift summaries and
      optional diffs (Spec: CLI Commands, Output & Logging).
- [x] Implement version matching checks that identify when a file matches another feature version
      and include that in `status` output (Spec: Drift Detection).
- [ ] Implement `sync` command with `--dry-run` default, `--apply`, and `--diff` support (Spec: Sync
      / Update Behavior).
- [ ] Implement merge strategies (`none`, `markers`, `keep-local`, `overwrite`) for sync conflicts
      (Spec: Merge strategies).
- [ ] Use a standard three-way merge tool (e.g., `git merge-file`) for sync updates (Spec: Sync /
      Update Behavior).
- [ ] Ensure sync is atomic per project by validating all changes before writing any files (Spec:
      Sync / Update Behavior).
- [x] Implement conflict detection across features and surface actionable errors (Spec: Conflict
      Handling).
- [ ] Implement `explain` command to show feature ownership and drift reasons (Spec: CLI Commands).
- [x] Add `--json` output mode for `projects` and `status` (Spec: Output & Logging).
- [ ] Add unit tests for config parsing, drift detection, and diff output (Spec: Output & Logging,
      Drift Detection).
- [ ] Update README with CLI examples and documented exit codes (Spec: CLI Commands, Output &
      Logging).
