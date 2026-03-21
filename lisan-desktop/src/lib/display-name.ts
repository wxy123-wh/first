export interface ResolveDisplayNameOptions {
  id?: string | null;
  nameById?: Record<string, string>;
  emptyLabel?: string;
  missingLabel?: string;
}

function normalizeId(id?: string | null): string | null {
  if (typeof id !== "string") {
    return null;
  }
  const normalized = id.trim();
  return normalized.length > 0 ? normalized : null;
}

export function idSuffix(id: string, length = 6): string {
  const normalized = id.trim();
  if (normalized.length === 0) {
    return "unknown";
  }
  if (normalized.length <= length) {
    return normalized;
  }
  return normalized.slice(-length);
}

export function resolveDisplayName({
  id,
  nameById = {},
  emptyLabel = "无",
  missingLabel = "已删除对象",
}: ResolveDisplayNameOptions): string {
  const normalizedId = normalizeId(id);
  if (!normalizedId) {
    return emptyLabel;
  }

  const mappedName = nameById[normalizedId];
  if (typeof mappedName === "string" && mappedName.trim().length > 0) {
    return mappedName;
  }

  return `${missingLabel}（ID后6位：${idSuffix(normalizedId)}）`;
}

export function findMissingReferenceIds(
  ids: string[],
  nameById: Record<string, string>,
): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const id of ids) {
    const normalized = normalizeId(id);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (!nameById[normalized]) {
      missing.push(normalized);
    }
  }
  return missing;
}
