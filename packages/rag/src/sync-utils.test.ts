import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectSyncMarkdownFiles,
  DEFAULT_SYNC_DIRS,
  inferDocumentType,
  scanMarkdownFiles,
} from './sync-utils.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeMarkdown(root: string, relativePath: string): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, '# title\n\nbody', 'utf-8');
}

describe('rag sync-utils', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('includes chapters in default sync directories', () => {
    expect(DEFAULT_SYNC_DIRS).toContain('chapters');
  });

  it('infers chapter type for both 正文 and chapters directories', () => {
    const root = 'D:/book';
    expect(inferDocumentType('D:/book/正文/001.md', root)).toBe('chapter');
    expect(inferDocumentType('D:/book/chapters/001.md', root)).toBe('chapter');
  });

  it('scans markdown recursively and skips hidden directories', async () => {
    const root = await createTempDir('rag-sync-utils-');
    await writeMarkdown(root, 'chapters/001.md');
    await writeMarkdown(root, 'chapters/nested/002.md');
    await writeMarkdown(root, '.hidden/003.md');
    await writeFile(join(root, 'chapters/ignore.txt'), 'x', 'utf-8');

    const files = await scanMarkdownFiles(join(root, 'chapters'));
    const normalized = files.map((value) => value.replace(/\\/g, '/'));
    expect(normalized.some((value) => value.endsWith('/chapters/001.md'))).toBe(true);
    expect(normalized.some((value) => value.endsWith('/chapters/nested/002.md'))).toBe(true);
    expect(normalized.some((value) => value.endsWith('/.hidden/003.md'))).toBe(false);
    expect(normalized.some((value) => value.endsWith('/chapters/ignore.txt'))).toBe(false);
  });

  it('collects markdown from configured sync directories', async () => {
    const root = await createTempDir('rag-sync-collect-');
    await writeMarkdown(root, '设定集/world.md');
    await writeMarkdown(root, 'chapters/001.md');

    const files = await collectSyncMarkdownFiles(root);
    const normalized = files.map((value) => value.replace(/\\/g, '/'));
    expect(normalized.some((value) => value.endsWith('/设定集/world.md'))).toBe(true);
    expect(normalized.some((value) => value.endsWith('/chapters/001.md'))).toBe(true);
  });
});
