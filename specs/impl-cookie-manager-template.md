# Cookie Manager — Template Application Implementation Plan

- [x] Extend project config schema and loaders to include optional `templates` list (Spec: Project
      Config Schema).
- [x] Add template config schema and loader for `config/templates/<template>/template.json` and
      template file resolution (Spec: Template Definition Schema, Repo Layout).
- [x] Support glob expansion for template `files` entries (Spec: Template Definition Schema).
- [ ] Implement template rendering for template application using existing `templateVars`
      substitution (Spec: Template Rendering).
- [ ] Add `template ls` command to list configured templates (Spec: CLI Commands).
- [ ] Add `template apply <project> <template>` command wiring in the CLI, including argument
      parsing and help output (Spec: CLI Commands).
- [ ] Implement template application flow: load configs, validate missing template files/vars, check
      for existing target paths, write files, update project config `templates` list (Spec:
      `template apply` Behavior, Errors).
- [ ] Add tests for template application success, missing template vars, missing template files, and
      existing target paths, plus glob expansion (Spec: Template Definition Schema,
      `template     apply` Behavior, Errors).
- [ ] Update CLI documentation/help text to mention template commands and behavior (Spec: CLI
      Commands).
