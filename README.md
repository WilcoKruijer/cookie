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

## Exit codes

- `0`: report generated successfully
- `2`: fatal error (invalid config, missing template vars)
