type TemplateVars = Record<string, string> | undefined;

export function applyTemplateVars(content: string, templateVars: TemplateVars): string {
  const matches = [...content.matchAll(/\{\{([A-Za-z0-9_-]+)\}\}/g)];
  if (matches.length === 0) {
    return content;
  }

  const replacements = templateVars ?? {};
  for (const match of matches) {
    const key = match[1];
    if (!(key in replacements)) {
      throw new Error(`Missing template var: ${key}`);
    }
  }

  return content.replace(/\{\{([A-Za-z0-9_-]+)\}\}/g, (full, key: string) =>
    String(replacements[key]),
  );
}
