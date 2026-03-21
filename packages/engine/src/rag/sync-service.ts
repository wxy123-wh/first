import { nanoid } from 'nanoid';
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
        this.complete('completed', '未找到可同步的 Markdown 文件。');
        return;
      }

      const ragConfig = await loadRagConfig(this.projectRoot);
      const vectorStore = await this.vectorStoreFactory(this.projectRoot, ragConfig);
      this.status.stage = 'syncing';

      try {
        for (let i = 0; i < files.length; i += this.batchSize) {
          const batch = files.slice(i, i + this.batchSize);
          const docs: Document[] = [];
          const docSources: string[] = [];

          for (const filePath of batch) {
            const source = toPosix(relative(this.projectRoot, filePath));
            try {
              const content = await readFile(filePath, 'utf-8');
              docs.push({
                id: source,
                content,
                metadata: {
                  source,
                  type: inferDocumentTypeFromRag(filePath, this.projectRoot),
                  abstract: firstUsefulLine(content),
                },
              });
              docSources.push(source);
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
