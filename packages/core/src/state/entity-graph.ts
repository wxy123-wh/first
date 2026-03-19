// 实体图谱（SQLite）— 完整实现

import Database from 'better-sqlite3';

export interface Entity {
  id: string;
  name: string;
  type: 'character' | 'location' | 'item' | 'event';
  metadata: Record<string, unknown>;
  createdInChapter: number;
  arcId?: string;
  persistence?: 'chapter' | 'arc' | 'permanent';
  needsReview?: boolean;
}

/** 实体图谱接口 */
export interface EntityGraph {
  create(entity: Entity): void;
  getById(id: string): Entity | null;
  findByType(type: Entity['type'], arcId?: string): Entity[];
  update(id: string, patch: Partial<Entity>): void;
  delete(id: string): void;
  findNeedsReview(): Entity[];
  close(): void;
}

/** SQLite 行类型 */
interface EntityRow {
  id: string;
  name: string;
  type: string;
  metadata: string;
  createdInChapter: number;
  arcId: string | null;
  persistence: string | null;
  needsReview: number;
}

function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Entity['type'],
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdInChapter: row.createdInChapter,
    arcId: row.arcId ?? undefined,
    persistence: (row.persistence as Entity['persistence']) ?? undefined,
    needsReview: row.needsReview === 1,
  };
}

/**
 * SQLite 实体图谱实现
 * 基于 better-sqlite3
 */
export class SqliteEntityGraph implements EntityGraph {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('character','location','item','event')),
        metadata TEXT NOT NULL DEFAULT '{}',
        createdInChapter INTEGER NOT NULL,
        arcId TEXT,
        persistence TEXT CHECK(persistence IN ('chapter','arc','permanent')),
        needsReview INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_arcId ON entities(arcId);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_entities_needsReview ON entities(needsReview) WHERE needsReview = 1;
    `);
  }

  create(entity: Entity): void {
    const stmt = this.db.prepare(`
      INSERT INTO entities (id, name, type, metadata, createdInChapter, arcId, persistence, needsReview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entity.id,
      entity.name,
      entity.type,
      JSON.stringify(entity.metadata),
      entity.createdInChapter,
      entity.arcId ?? null,
      entity.persistence ?? null,
      entity.needsReview ? 1 : 0,
    );
  }

  getById(id: string): Entity | null {
    const stmt = this.db.prepare('SELECT * FROM entities WHERE id = ?');
    const row = stmt.get(id) as EntityRow | undefined;
    return row ? rowToEntity(row) : null;
  }

  findByType(type: Entity['type'], arcId?: string): Entity[] {
    let stmt;
    let rows: EntityRow[];
    if (arcId) {
      stmt = this.db.prepare(
        `SELECT * FROM entities WHERE type = ? AND (arcId = ? OR persistence = 'permanent')`,
      );
      rows = stmt.all(type, arcId) as EntityRow[];
    } else {
      stmt = this.db.prepare('SELECT * FROM entities WHERE type = ?');
      rows = stmt.all(type) as EntityRow[];
    }
    return rows.map(rowToEntity);
  }

  update(id: string, patch: Partial<Entity>): void {
    const existing = this.getById(id);
    if (!existing) return;

    const merged = { ...existing, ...patch };
    const stmt = this.db.prepare(`
      UPDATE entities SET name=?, type=?, metadata=?, createdInChapter=?, arcId=?, persistence=?, needsReview=?
      WHERE id=?
    `);
    stmt.run(
      merged.name,
      merged.type,
      JSON.stringify(merged.metadata),
      merged.createdInChapter,
      merged.arcId ?? null,
      merged.persistence ?? null,
      merged.needsReview ? 1 : 0,
      id,
    );
  }

  delete(id: string): void {
    const stmt = this.db.prepare('DELETE FROM entities WHERE id = ?');
    stmt.run(id);
  }

  findNeedsReview(): Entity[] {
    const stmt = this.db.prepare('SELECT * FROM entities WHERE needsReview = 1');
    const rows = stmt.all() as EntityRow[];
    return rows.map(rowToEntity);
  }

  close(): void {
    this.db.close();
  }
}
