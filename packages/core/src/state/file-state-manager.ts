// 文件状态管理器实现

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ChapterRecord, ProjectState, StateManager } from './types.js';

const STATE_FILE = 'state.json';
const CURRENT_SCHEMA_VERSION = '1';

/** 迁移函数：接收旧状态，返回新状态 */
type MigrationFn = (state: Record<string, unknown>) => Record<string, unknown>;

/** 迁移注册表：fromVersion → { toVersion, fn } */
const migrations: Map<string, { toVersion: string; fn: MigrationFn }> = new Map();

/** 注册一个 schema 迁移 */
export function registerMigration(fromVersion: string, toVersion: string, fn: MigrationFn): void {
  migrations.set(fromVersion, { toVersion, fn });
}

/** 基于文件的状态管理器 */
export class FileStateManager implements StateManager {
  private readonly statePath: string;

  constructor(projectRoot: string) {
    this.statePath = join(projectRoot, '.lisan', STATE_FILE);
  }

  async load(): Promise<ProjectState> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const state = JSON.parse(raw) as ProjectState;
      if (state.version !== CURRENT_SCHEMA_VERSION) {
        const migrated = this.migrate(state);
        await this.save(migrated);
        return migrated;
      }
      return state;
    } catch {
      return this.defaultState();
    }
  }

  async save(state: ProjectState): Promise<void> {
    state.lastUpdated = new Date().toISOString();
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async updateChapter(number: number, patch: Partial<ChapterRecord>): Promise<void> {
    const state = await this.load();
    const existing = state.chapters[number] ?? {
      number,
      title: '',
      status: 'pending' as const,
      filePath: '',
    };
    state.chapters[number] = { ...existing, ...patch };
    await this.save(state);
  }

  private defaultState(): ProjectState {
    return {
      version: CURRENT_SCHEMA_VERSION,
      bookId: '',
      currentChapter: 0,
      currentArc: '',
      chapters: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  private migrate(state: ProjectState): ProjectState {
    let current = state as unknown as Record<string, unknown>;
    let version = (current['version'] as string) ?? '0';
    const visited = new Set<string>();

    while (version !== CURRENT_SCHEMA_VERSION) {
      if (visited.has(version)) {
        throw new Error(`Schema 迁移循环检测：版本 ${version} 已被访问`);
      }
      visited.add(version);

      const migration = migrations.get(version);
      if (!migration) {
        // 无已注册迁移路径，强制设为当前版本
        current['version'] = CURRENT_SCHEMA_VERSION;
        break;
      }
      current = migration.fn(current);
      version = migration.toVersion;
      current['version'] = version;
    }

    return current as unknown as ProjectState;
  }
}
