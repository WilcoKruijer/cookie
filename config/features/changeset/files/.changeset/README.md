# Changesets

This repo uses Changesets to manage versioning and releases for publishable packages.

## Expected drift (keep concise)
- Config drift is normal when a project needs custom `access`, `fixed`/`linked`, or `ignore` rules.
- README drift is normal when a project keeps the default Changesets README.
- Removing Changesets entirely is expected for non-publishable projects; remove the feature in
  `config/projects/*.json` and omit the `.changeset` folder.
