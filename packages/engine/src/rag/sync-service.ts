import { nanoid } from 'nanoid';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  collectSyncMarkdownFiles,
  DashScopeEmbeddingProvider,
  inferDocumentType as inferDocumentTypeFromRag,
  LanceDBStore,
  type Document,
} from '@lisan/rag';

const RAG_CONFIG_FILES = [
  'lisan.config.yaml',
  'lisan.config.yml',
  'lisan.config.json',
  '.lisanrc.yaml',
  '.lisanrc.json',
] as const;
const LEGACY_OUTLINE_FILE = 'outline.md';
const CANONICAL_OUTLINE_FILE = join('大纲', 'arc-1.md');
const RAG_CONTEXT_CACHE_FILE = join('.lisan', 'rag-context-cache.json');
const RAG_CONTEXT_CONTENT_LIMIT = 4000;
const RAG_CONTEXT_EXCERPT_LIMIT = 220;

export { scanMarkdownFiles, inferDocumentType } from '@lisan/rag';

export type RagSyncStage = 'idle' | 'scanning' | 'syncing' | 'completed' | 'failed';
export type RagSyncEventMethod =
  | 'rag:sync:start'
  | 'rag:sync:progress'
  | 'rag:sync:complete'
  | 'rag:sync:failed';

export interface RagSyncFailure {
  file: string;
  reason: string;
}

export interface RagSyncStats {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
}

export interface RagSyncStatus {
  stage: RagSyncStage;
  running: boolean;
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  message: string;
  currentFile: string | null;
  stats: RagSyncStats;
  failures: RagSyncFailure[];
}

export interface RagSyncEvent {
  method: RagSyncEventMethod;
  params: RagSyncStatus;
}

interface RagEmbeddingConfig {
  embedModel: string;
  embedBaseUrl?: string;
  embedApiKey?: string;
}

interface RagVectorStore {
  upsert(docs: Document[]): Promise<void>;
  close(): void;
}

interface RagSyncServiceOptions {
  projectRoot: string;
  batchSize?: number;
  emit?: (event: RagSyncEvent) => void;
  createVectorStore?: (
    projectRoot: string,
    config: RagEmbeddingConfig,
  ) => Promise<RagVectorStore>;
}

export interface RagSyncStartResult {
  started: boolean;
  status: RagSyncStatus;
}

interface RagContextCacheEntry {
  source: string;
  type: Document['metadata']['type'];
  abstract: string;
  content: string;
}

export interface RagContextReference {
  source: string;
  type: Document['metadata']['type'];
  abstract: string;
  excerpt: string;
  score: number;
}

const INITIAL_STATUS: RagSyncStatus = {
  stage: 'idle',
  running: false,
  runId: null,
  startedAt: null,
  completedAt: null,
  message: '尚未开始同步',
  currentFile: null,
  stats: {
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
  },
  failures: [],
};

function cloneStatus(status: RagSyncStatus): RagSyncStatus {
  return {
    ...status,
    stats: { ...status.stats },
    failures: status.failures.map((failure) => ({ ...failure })),
  };
}

function toPosix(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

function clipText(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase();
}

function extractSearchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  const tokens = normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    deduped.push(token);
  }
  return deduped;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (cursor < haystack.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) {
      break;
    }
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function buildExcerpt(content: string, token: string): string {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  if (!normalizedContent) {
    return '';
  }
  const normalizedToken = token.trim().toLocaleLowerCase();
  if (!normalizedToken) {
    return clipText(normalizedContent, RAG_CONTEXT_EXCERPT_LIMIT);
  }

  const lowerContent = normalizedContent.toLocaleLowerCase();
  const index = lowerContent.indexOf(normalizedToken);
  if (index < 0) {
    return clipText(normalizedContent, RAG_CONTEXT_EXCERPT_LIMIT);
  }
  const start = Math.max(0, index - Math.floor(RAG_CONTEXT_EXCERPT_LIMIT / 2));
  const end = Math.min(normalizedContent.length, start + RAG_CONTEXT_EXCERPT_LIMIT);
  return clipText(normalizedContent.slice(start, end), RAG_CONTEXT_EXCERPT_LIMIT);
}

function cachePathForProject(projectRoot: string): string {
  return join(projectRoot, RAG_CONTEXT_CACHE_FILE);
}

function parseRagContextCache(raw: string): RagContextCacheEntry[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  const entries: RagContextCacheEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const source = typeof record.source === 'string' ? record.source.trim() : '';
    const type = typeof record.type === 'string' ? record.type.trim() : '';
    if (!source || !type) {
      continue;
    }
    const abstract =
      typeof record.abstract === 'string' ? clipText(record.abstract, 400) : '';
    const content =
      typeof record.content === 'string' ? clipText(record.content, RAG_CONTEXT_CONTENT_LIMIT) : '';
    entries.push({
      source,
      type: type as Document['metadata']['type'],
      abstract,
      content,
    });
  }
  return entries;
}

function readRagContextCache(projectRoot: string): RagContextCacheEntry[] {
  const cachePath = cachePathForProject(projectRoot);
  if (!existsSync(cachePath)) {
    return [];
  }
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    return parseRagContextCache(raw);
  } catch {
    return [];
  }
}

function toCacheEntry(doc: Document): RagContextCacheEntry {
  return {
    source: doc.metadata.source,
    type: doc.metadata.type,
    abstract: clipText(doc.metadata.abstract ?? '', 400),
    content: clipText(doc.content, RAG_CONTEXT_CONTENT_LIMIT),
  };
}

async function writeRagContextCache(projectRoot: string, entries: RagContextCacheEntry[]): Promise<void> {
  const cachePath = cachePathForProject(projectRoot);
  const deduped = new Map<string, RagContextCacheEntry>();
  for (const entry of entries) {
    deduped.set(entry.source, entry);
  }
  const payload = JSON.stringify([...deduped.values()], null, 2);
  await mkdir(join(projectRoot, '.lisan'), { recursive: true });
  await writeFile(cachePath, payload, 'utf-8');
}

export function searchRagContext(projectRoot: string, query: string, topK = 4): RagContextReference[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const entries = readRagContextCache(projectRoot);
  if (entries.length === 0) {
    return [];
  }

  const lowerQuery = normalizeSearchText(normalizedQuery);
  const tokens = extractSearchTokens(normalizedQuery);

  const scored = entries
    .map((entry) => {
      const haystack = normalizeSearchText(
        `${entry.source}\n${entry.abstract}\n${entry.content}`,
      );
      let score = 0;
      if (haystack.includes(lowerQuery)) {
        score += 8;
      }
      for (const token of tokens) {
        const occurrences = countOccurrences(haystack, token);
        if (occurrences > 0) {
          score += Math.min(occurrences, 3) * 2;
        }
      }
      return {
        entry,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const limit = Math.max(1, Math.floor(topK));
  return scored.slice(0, limit).map(({ entry, score }) => {
    const excerptToken = tokens.find((token) => {
      const content = normalizeSearchText(entry.content);
      return content.includes(token);
    }) ?? '';
    const abstract = entry.abstract || firstUsefulLine(entry.content);
    return {
      source: entry.source,
      type: entry.type,
      abstract,
      excerpt: buildExcerpt(entry.content, excerptToken),
      score,
    };
  });
}

function normalizeYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  const commentIndex = trimmed.indexOf(' #');
  return (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
}

function resolveEnvPlaceholders(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envName: string) => {
    return process.env[envName]?.trim() ?? '';
  });
}

function parseRagConfigFromJson(content: string): Partial<RagEmbeddingConfig> {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const rag = parsed?.rag;
  if (!rag || typeof rag !== 'object' || Array.isArray(rag)) {
    return {};
  }
  const ragRecord = rag as Record<string, unknown>;
  const embedModel =
    typeof ragRecord.embedModel === 'string' ? resolveEnvPlaceholders(ragRecord.embedModel).trim() : '';
  const embedBaseUrl =
    typeof ragRecord.embedBaseUrl === 'string'
      ? resolveEnvPlaceholders(ragRecord.embedBaseUrl).trim()
      : '';
  const embedApiKey =
    typeof ragRecord.embedApiKey === 'string' ? resolveEnvPlaceholders(ragRecord.embedApiKey).trim() : '';
  return {
    embedModel: embedModel || undefined,
    embedBaseUrl: embedBaseUrl || undefined,
    embedApiKey: embedApiKey || undefined,
  };
}

function parseRagConfigFromYaml(content: string): Partial<RagEmbeddingConfig> {
  const lines = content.split(/\r?\n/);
  let inRagSection = false;
  let ragIndent = -1;
  const nextConfig: Partial<RagEmbeddingConfig> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const indent = line.length - line.trimStart().length;

    if (!inRagSection) {
      if (trimmed === 'rag:' || trimmed.startsWith('rag:')) {
        inRagSection = true;
        ragIndent = indent;
      }
      continue;
    }

    if (indent <= ragIndent) {
      inRagSection = false;
      continue;
    }

    const separator = trimmed.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const normalized = resolveEnvPlaceholders(
      normalizeYamlScalar(trimmed.slice(separator + 1)),
    ).trim();
    if (!normalized) {
      continue;
    }

    if (key === 'embedModel') {
      nextConfig.embedModel = normalized;
    } else if (key === 'embedBaseUrl') {
      nextConfig.embedBaseUrl = normalized;
    } else if (key === 'embedApiKey') {
      nextConfig.embedApiKey = normalized;
    }
  }

  return nextConfig;
}

async function loadRagConfig(projectRoot: string): Promise<RagEmbeddingConfig> {
  const config: RagEmbeddingConfig = {
    embedModel: 'text-embedding-v3',
  };

  for (const candidate of RAG_CONFIG_FILES) {
    const fullPath = join(projectRoot, candidate);
    let content = '';
    try {
      content = await readFile(fullPath, 'utf-8');
    } catch {
      continue;
    }

    try {
      const parsed = candidate.endsWith('.json')
        ? parseRagConfigFromJson(content)
        : parseRagConfigFromYaml(content);
      if (parsed.embedModel) {
        config.embedModel = parsed.embedModel;
      }
      if (parsed.embedBaseUrl) {
        config.embedBaseUrl = parsed.embedBaseUrl;
      }
      if (parsed.embedApiKey) {
        config.embedApiKey = parsed.embedApiKey;
      }
    } catch {
      // Ignore invalid config and fall back to defaults/env.
    }
    break;
  }

  return config;
}

async function migrateLegacyOutlineIfNeeded(projectRoot: string): Promise<void> {
  const canonicalPath = join(projectRoot, CANONICAL_OUTLINE_FILE);
  try {
    await readFile(canonicalPath, 'utf-8');
    return;
  } catch {
    // Continue and attempt legacy migration.
  }

  const legacyPath = join(projectRoot, LEGACY_OUTLINE_FILE);
  try {
    const legacyContent = await readFile(legacyPath, 'utf-8');
    await mkdir(join(projectRoot, '大纲'), { recursive: true });
    await writeFile(canonicalPath, legacyContent, 'utf-8');
    await rm(legacyPath, { force: true });
  } catch {
    // Ignore if legacy outline is not present.
  }
}

async function createDefaultVectorStore(
  projectRoot: string,
  config: RagEmbeddingConfig,
): Promise<RagVectorStore> {
  const embeddingProvider = new DashScopeEmbeddingProvider({
    apiKey: config.embedApiKey || undefined,
    model: config.embedModel || undefined,
    baseUrl: config.embedBaseUrl || undefined,
  });
  const store = new LanceDBStore({
    dbPath: join(projectRoot, '.lisan', 'vectors'),
    embeddingProvider,
  });
  await store.init();
  return store;
}

function firstUsefulLine(content: string): string {
  const line = content.split(/\r?\n/).find((value) => value.trim().length > 0) ?? '';
  return line.replace(/^#+\s*/, '').trim().slice(0, 200);
}

async function scanSyncFiles(projectRoot: string): Promise<string[]> {
  return collectSyncMarkdownFiles(projectRoot);
}

export class RagSyncService {
  private readonly projectRoot: string;
  private readonly batchSize: number;
  private readonly emitHandler?: (event: RagSyncEvent) => void;
  private readonly vectorStoreFactory: (
    projectRoot: string,
    config: RagEmbeddingConfig,
  ) => Promise<RagVectorStore>;
  private status: RagSyncStatus = cloneStatus(INITIAL_STATUS);
  private runningPromise: Promise<void> | null = null;

  constructor(options: RagSyncServiceOptions) {
    this.projectRoot = options.projectRoot;
    this.batchSize = Math.max(1, options.batchSize ?? 10);
    this.emitHandler = options.emit;
    this.vectorStoreFactory = options.createVectorStore ?? createDefaultVectorStore;
  }

  getStatus(): RagSyncStatus {
    return cloneStatus(this.status);
  }

  async startSync(): Promise<RagSyncStartResult> {
    if (this.status.running) {
      return {
        started: false,
        status: this.getStatus(),
      };
    }

    this.status = {
      stage: 'scanning',
      running: true,
      runId: nanoid(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      message: '正在扫描可同步文件...',
      currentFile: null,
      stats: { total: 0, processed: 0, succeeded: 0, failed: 0 },
      failures: [],
    };
    this.emit('rag:sync:start');

    this.runningPromise = this.run().finally(() => {
      this.runningPromise = null;
    });

    return {
      started: true,
      status: this.getStatus(),
    };
  }

  private emit(method: RagSyncEventMethod): void {
    if (!this.emitHandler) {
      return;
    }
    this.emitHandler({
      method,
      params: this.getStatus(),
    });
  }

  private addFailure(file: string, reason: string): void {
    this.status.failures.push({ file, reason });
    this.status.stats.failed += 1;
  }

  private updateProgress(message: string, currentFile?: string): void {
    this.status.message = message;
    this.status.currentFile = currentFile ?? null;
    this.emit('rag:sync:progress');
  }

  private complete(stage: Extract<RagSyncStage, 'completed' | 'failed'>, message: string): void {
    this.status.stage = stage;
    this.status.running = false;
    this.status.completedAt = new Date().toISOString();
    this.status.message = message;
    this.status.currentFile = null;
    this.emit(stage === 'completed' ? 'rag:sync:complete' : 'rag:sync:failed');
  }

  private async run(): Promise<void> {
    try {
      await migrateLegacyOutlineIfNeeded(this.projectRoot);
      const files = await scanSyncFiles(this.projectRoot);
      this.status.stats.total = files.length;

      if (files.length === 0) {
        try {
          await writeRagContextCache(this.projectRoot, []);
        } catch {
          // Ignore cache write failures so sync status remains based on vector indexing.
        }
        this.complete('completed', '未找到可同步的 Markdown 文件。');
        return;
      }

      const ragConfig = await loadRagConfig(this.projectRoot);
      const vectorStore = await this.vectorStoreFactory(this.projectRoot, ragConfig);
      this.status.stage = 'syncing';
      const cachedEntries: RagContextCacheEntry[] = [];

      try {
        for (let i = 0; i < files.length; i += this.batchSize) {
          const batch = files.slice(i, i + this.batchSize);
          const docs: Document[] = [];
          const docSources: string[] = [];
          const batchEntries: RagContextCacheEntry[] = [];

          for (const filePath of batch) {
            const source = toPosix(relative(this.projectRoot, filePath));
            try {
              const content = await readFile(filePath, 'utf-8');
              const doc: Document = {
                id: source,
                content,
                metadata: {
                  source,
                  type: inferDocumentTypeFromRag(filePath, this.projectRoot),
                  abstract: firstUsefulLine(content),
                },
              };
              docs.push(doc);
              docSources.push(source);
              batchEntries.push(toCacheEntry(doc));
            } catch (error) {
              this.status.stats.processed += 1;
              this.addFailure(source, error instanceof Error ? error.message : String(error));
            }
          }

          if (docs.length > 0) {
            try {
              await vectorStore.upsert(docs);
              this.status.stats.processed += docs.length;
              this.status.stats.succeeded += docs.length;
              cachedEntries.push(...batchEntries);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              for (const source of docSources) {
                this.status.stats.processed += 1;
                this.addFailure(source, reason);
              }
            }
          }

          const currentFile = docSources.length > 0 ? docSources[docSources.length - 1] : undefined;
          this.updateProgress(
            `同步中：${this.status.stats.processed}/${this.status.stats.total}`,
            currentFile,
          );
        }

        try {
          await writeRagContextCache(this.projectRoot, cachedEntries);
        } catch {
          // Ignore cache write failures so successful vector sync still completes.
        }
      } finally {
        vectorStore.close();
      }

      this.complete(
        'completed',
        `同步完成：成功 ${this.status.stats.succeeded}，失败 ${this.status.stats.failed}。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.complete('failed', `同步失败：${message}`);
    }
  }
}
