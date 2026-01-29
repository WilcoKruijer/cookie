# CLAUDE.md

## Overview

Cookie is a monorepo for the Cookie Manager CLI, which standardizes and synchronizes repo setup
across related projects (kc, fragno, thalo, is3a-site, and this repo).

## Setup

```bash
pnpm install
```

## Common Commands

- `pnpm exec turbo run types:check build test`
- `pnpm run format`
- `pnpm run lint`

## Package Structure

### `apps/`

| App              | Description                              |
| ---------------- | ---------------------------------------- |
| `cookie-manager` | CLI for managing repo feature baselines. |
