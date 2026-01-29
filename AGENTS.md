# AGENTS

This is the "command center" for various projects on this machine.

This repository contains the Cookie Manager CLI, which manages certain features that are present in
multiple projects on this machine. The CLI allows you check if there is drift between the feature
templates and the project files.

You may also be asked from an LLM session in this repository to work on the different projects. If
you are unsure where the project is located, you can use the `projects` command to list the
configured projects.

## Agent Guidelines

- After every change, run type check and relevant tests. ALWAYS.

## Repo overview

- Cookie is a monorepo containing the Cookie Manager CLI.
- The CLI enforces standard setup across related repos by feature domain (changeset, ci, lint,
  monorepo, lefthook, ai).

## Key paths

- CLI source: `apps/cookie-manager/src`
- CLI package config: `apps/cookie-manager/package.json`
- Feature templates: `config/features/<feature>/files/...`
- Feature definitions: `config/features/<feature>/feature.json`
- Project configs: `config/projects/*.json`
- Specs: `specs/`

## Common commands

- Install deps: `pnpm install`
- CLI help: `pnpm exec cookie-manager --help`
- Check drift: `pnpm exec cookie-manager check --feature <name> [--project <name>]`
- Tests (CLI): `pnpm -C apps/cookie-manager test`
- Build (CLI): `pnpm -C apps/cookie-manager build`

## Changesets

- This repo can use Changesets for versioning. Review `specs/COMMIT.md` for when to add changesets.
- If a project should not use Changesets, remove the `changeset` feature from its
  `config/projects/*.json` entry.

## Expectations when editing

- Keep feature templates and project configs aligned unless drift is explicitly intended and
  documented.
- If you change how a feature is checked, update the prompt logic/tests in `apps/cookie-manager/src`
  as needed.
- Prefer small, focused changes; avoid editing unrelated files.
