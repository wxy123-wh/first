import { readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import type { DocumentType } from './types.js';

export const DEFAULT_SYNC_DIRS = ['设定集', '大纲', '场景树', '正文', 'chapters'] as const;

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

export async function scanMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...(await scanMarkdownFiles(fullPath)));
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
        files.push(fullPath);
      }
    }
  } catch {
    // Ignore missing directories.
  }
  return files;
}

export function inferDocumentType(filePath: string, projectRoot: string): DocumentType {
  const rel = toPosixPath(relative(projectRoot, filePath));
  if (rel.startsWith('设定集/')) return 'setting';
  if (rel.startsWith('大纲/')) return 'outline';
  if (rel.startsWith('场景树/')) return 'scene';
  if (rel.startsWith('正文/') || rel.startsWith('chapters/')) return 'chapter';
  if (rel === 'outline.md') return 'outline';
  return 'reference';
}

export async function collectSyncMarkdownFiles(
  projectRoot: string,
  syncDirs: readonly string[] = DEFAULT_SYNC_DIRS,
): Promise<string[]> {
  const files: string[] = [];
  for (const dirName of syncDirs) {
    files.push(...(await scanMarkdownFiles(join(projectRoot, dirName))));
  }
  return files;
}
