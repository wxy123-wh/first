import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Document } from '@lisan/rag';
import {
  RagSyncService,
  inferDocumentType,
  scanMarkdownFiles,
  type RagSyncEvent,
} from './sync-service.js';

const tempDirs: string[] = [];

async function createTempProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeMarkdown(root: string, relativePath: string, content: string): Promise<void> {
  const fullPath = join(root, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

describe('rag sync helpers', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('infers DocumentType from canonical folder prefixes', () => {
    const projectRoot = 'D:/book';
    expect(inferDocumentType('D:/book/设定集/world.md', projectRoot)).toBe('setting');
    expect(inferDocumentType('D:/book/大纲/arc-1.md', projectRoot)).toBe('outline');
    expect(inferDocumentType('D:/book/场景树/s1.md', projectRoot)).toBe('scene');
    expect(inferDocumentType('D:/book/正文/ch01.md', projectRoot)).toBe('chapter');
    expect(inferDocumentType('D:/book/chapters/ch01.md', projectRoot)).toBe('chapter');
    expect(inferDocumentType('D:/book/notes/misc.md', projectRoot)).toBe('reference');
  });

  it('scans markdown recursively and skips hidden directories', async () => {
    const projectRoot = await createTempProject('lisan-rag-scan-');
    await writeMarkdown(projectRoot, '设定集/a.md', '# a');
    await writeMarkdown(projectRoot, '设定集/nested/b.md', '# b');
    await writeMarkdown(projectRoot, '.hidden/c.md', '# c');
    await writeMarkdown(projectRoot, '正文/ch01.txt', 'not markdown');

    const files = await scanMarkdownFiles(projectRoot);
    const normalized = files.map((file) => file.replace(/\\/g, '/'));
    expect(normalized.some((file) => file.endsWith('/设定集/a.md'))).toBe(true);
    expect(normalized.some((file) => file.endsWith('/设定集/nested/b.md'))).toBe(true);
    expect(normalized.some((file) => file.endsWith('/.hidden/c.md'))).toBe(false);
    expect(normalized.some((file) => file.endsWith('/正文/ch01.txt'))).toBe(false);
  });
});

describe('RagSyncService', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('runs sync and emits progress with success/failure stats', async () => {
    const projectRoot = await createTempProject('lisan-rag-run-');
    await writeMarkdown(projectRoot, '设定集/world.md', '# 世界观\r\n内容');
    await writeMarkdown(projectRoot, 'chapters/ch01.md', '# 第一章\r\n内容');

    const docs: Document[] = [];
    const events: RagSyncEvent[] = [];
    const service = new RagSyncService({
      projectRoot,
      batchSize: 1,
      emit: (event) => {
        events.push(event);
      },
      createVectorStore: async () => ({
        async upsert(input) {
          docs.push(...input);
        },
        close() {
          // noop
        },
      }),
    });

    const start = await service.startSync();
    expect(start.started).toBe(true);

    for (let i = 0; i < 200; i += 1) {
      if (!service.getStatus().running) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const status = service.getStatus();
    expect(status.stage).toBe('completed');
    expect(status.stats.total).toBe(2);
    expect(status.stats.succeeded).toBe(2);
    expect(status.stats.failed).toBe(0);
    expect(docs).toHaveLength(2);
    expect(docs[0].metadata.source.length).toBeGreaterThan(0);
    expect(events.some((event) => event.method === 'rag:sync:start')).toBe(true);
    expect(events.some((event) => event.method === 'rag:sync:complete')).toBe(true);
  });
});
