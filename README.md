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

# Check drift across all projects (human-readable)
pnpm exec tsx apps/cookie-manager/src/cli.ts status

# Check drift for one project (JSON output)
pnpm exec tsx apps/cookie-manager/src/cli.ts status --project fragno --json

# Preview sync changes with diffs
pnpm exec tsx apps/cookie-manager/src/cli.ts sync --project fragno --diff

# Apply sync changes (writes files)
pnpm exec tsx apps/cookie-manager/src/cli.ts sync --project fragno --apply

# Explain why a file is out of sync
pnpm exec tsx apps/cookie-manager/src/cli.ts explain fragno .github/workflows/ci.yml

# Collect drift report (Markdown)
pnpm exec tsx apps/cookie-manager/src/cli.ts collect --diff
```

## Exit codes

- `0`: no drift or successful sync
- `1`: drift or conflicts found
- `2`: fatal error (invalid config, missing templates)
