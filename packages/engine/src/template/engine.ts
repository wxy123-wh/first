export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path: string) => {
    const keys = path.trim().split('.');
    let value: unknown = context;
    for (const key of keys) {
      if (value == null || typeof value !== 'object') return match;
      value = (value as Record<string, unknown>)[key];
    }
    if (value === undefined) return match;
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  });
}
