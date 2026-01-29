# Cookie Manager — Check-Only Implementation Plan

- [x] Remove feature versioning from config loaders and schemas; update config parsing to use
      unversioned `config/features/<feature>/feature.json` (Spec: Decisions, Feature Definition
      Schema).
- [x] Simplify feature metadata handling to a single `files` list and delete support for `changes`,
      `fileMerge`, `templateFiles`, `fileRules`, and conflict ownership (Spec: Feature Definition
      Schema, Decisions).
- [x] Remove sync/drift/explain/collect command implementations, CLI flags, and related utilities
      (Spec: Decisions, CLI Commands).
- [x] Implement the `check` command to load templates and project files, render templates with
      `templateVars`, and generate the Markdown report structure (Spec: `check` Behavior, Report
      Format, Template Rendering).
- [x] Report missing template files in the Markdown output without treating them as fatal errors
      (Spec: Decisions, Report Format).
- [x] Add LLM prompt generation and embed it in the report output exactly as specified (Spec: LLM
      Prompt).
- [x] Update `projects` and `show` commands to reflect the new project schema (Spec: Project Config
      Schema, CLI Commands).
- [x] Remove or refactor tests that assert sync/drift behavior; add tests for `check` report
      ordering, missing file markers, and prompt inclusion (Spec: Report Format, Output & Logging).
- [x] Update README CLI examples and exit codes to reflect the new `check`-only workflow (Spec: CLI
      Commands, Output & Logging).
