import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Database {
  readonly raw: BetterSqlite3.Database;

  constructor(projectPath: string) {
    const lisanDir = join(projectPath, '.lisan');
    mkdirSync(lisanDir, { recursive: true });
    this.raw = new BetterSqlite3(join(lisanDir, 'lisan.db'));
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        basePath TEXT NOT NULL,
        sceneTagTemplate TEXT DEFAULT '[]',
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('anthropic', 'openai', 'newapi')),
        model TEXT NOT NULL DEFAULT 'gpt-4o',
        baseUrl TEXT,
        apiKey TEXT,
        apiKeyCiphertext TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        kind TEXT CHECK(kind IN ('scene', 'chapter')),
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflow_steps (
        id TEXT PRIMARY KEY,
        workflowId TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        "order" INTEGER NOT NULL,
        agentId TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        projectId TEXT REFERENCES projects(id),
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('builtin', 'custom')),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.7,
        maxTokens INTEGER,
        agentMdPath TEXT NOT NULL,
        promptTemplate TEXT NOT NULL DEFAULT '',
        inputSchema TEXT DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        workflowId TEXT REFERENCES workflows(id),
        contentPath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        chapterId TEXT REFERENCES chapters(id),
        parentId TEXT REFERENCES scenes(id),
        "order" INTEGER NOT NULL,
        title TEXT NOT NULL,
        characters TEXT DEFAULT '[]',
        location TEXT DEFAULT '',
        eventSkeleton TEXT DEFAULT '[]',
        tags TEXT DEFAULT '{}',
        sourceOutline TEXT DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS executions (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        chapterId TEXT REFERENCES chapters(id),
        workflowId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        startedAt TEXT NOT NULL,
        completedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS execution_steps (
        id TEXT PRIMARY KEY,
        executionId TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        stepId TEXT NOT NULL,
        agentId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        input TEXT,
        output TEXT,
        tokens INTEGER,
        duration INTEGER,
        "order" INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id),
        type TEXT NOT NULL CHECK(type IN ('character', 'location', 'item', 'event')),
        name TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        summary TEXT DEFAULT '',
        filePath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(projectId, filePath)
      );
    `);

    const providerColumns = this.raw
      .prepare(`PRAGMA table_info(providers)`)
      .all() as Array<{ name: string }>;
    const workflowColumns = this.raw
      .prepare(`PRAGMA table_info(workflows)`)
      .all() as Array<{ name: string }>;
    const hasModelColumn = providerColumns.some((column) => column.name === 'model');
    const hasApiKeyCiphertextColumn = providerColumns.some(
      (column) => column.name === 'apiKeyCiphertext',
    );
    const hasWorkflowKindColumn = workflowColumns.some((column) => column.name === 'kind');

    if (!hasWorkflowKindColumn) {
      this.raw.exec(
        `ALTER TABLE workflows ADD COLUMN kind TEXT CHECK(kind IN ('scene', 'chapter'));`,
      );
    }

    if (!hasApiKeyCiphertextColumn) {
      this.raw.exec(`ALTER TABLE providers ADD COLUMN apiKeyCiphertext TEXT;`);
    }

    if (!hasModelColumn) {
      this.raw.exec(`ALTER TABLE providers ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-4o';`);
      this.raw.exec(`
        UPDATE providers
        SET model = CASE
          WHEN id = 'anthropic' THEN 'claude-opus-4-6'
          WHEN id = 'openai' THEN 'gpt-4o'
          WHEN id = 'newapi' THEN 'gpt-4o'
          ELSE COALESCE(NULLIF(model, ''), 'gpt-4o')
        END;
      `);
    }

    if (hasModelColumn) {
      this.raw.exec(`
        UPDATE providers
        SET model = CASE
          WHEN id = 'anthropic' THEN COALESCE(NULLIF(model, ''), 'claude-opus-4-6')
          WHEN id = 'openai' THEN COALESCE(NULLIF(model, ''), 'gpt-4o')
          WHEN id = 'newapi' THEN COALESCE(NULLIF(model, ''), 'gpt-4o')
          ELSE COALESCE(NULLIF(model, ''), 'gpt-4o')
        END;
      `);
    }
  }

  close(): void {
    this.raw.close();
  }
}
