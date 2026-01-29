type TemplateVars = Record<string, string> | undefined;
type TemplateVarOptions = {
  ignoredVariables?: string[];
};

export function applyTemplateVars(
  content: string,
  templateVars: TemplateVars,
  options?: TemplateVarOptions,
): string {
  const matches = [...content.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)];
  if (matches.length === 0) {
    return content;
  }

  const ignored = new Set(options?.ignoredVariables ?? []);
  const replacements = templateVars ?? {};
  for (const match of matches) {
    const key = match[1];
    if (!(key in replacements) && !ignored.has(key)) {
      throw new Error(`Missing template var: ${key}`);
    }
  }

  return content.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (full, key: string) => {
    if (key in replacements) {
      return String(replacements[key]);
    }
    return full;
  });
}
