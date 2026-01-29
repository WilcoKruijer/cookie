# Cookie

Cookie is a monorepo that houses the Cookie Manager CLI. The CLI enforces standard setup across
related repos by feature domain (changeset, ci, lint, monorepo, lefthook, ai).

## Quick start

```bash
pnpm install
pnpm exec tsx apps/cookie-manager/src/cli.ts --help
```

## CLI examples

```bash
# List configured projects
pnpm exec tsx apps/cookie-manager/src/cli.ts projects

# Show a single project config
pnpm exec tsx apps/cookie-manager/src/cli.ts show fragno

# Generate a drift report for one feature across all projects
pnpm exec tsx apps/cookie-manager/src/cli.ts check --feature lint

# Limit the report to one project and write to a file
pnpm exec tsx apps/cookie-manager/src/cli.ts check --feature lint --project fragno --output report.md
```

## Exit codes

- `0`: report generated successfully
- `2`: fatal error (invalid config, missing template vars)
