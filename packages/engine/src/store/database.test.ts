import { describe, it, expect, afterEach } from 'vitest';
import { Database } from './database.js';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), 'lisan-test-' + Date.now());

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('Database', () => {
  it('creates .lisan directory and lisan.db on init', () => {
    mkdirSync(testDir, { recursive: true });
    const db = new Database(testDir);
    expect(existsSync(join(testDir, '.lisan', 'lisan.db'))).toBe(true);
    db.close();
  });

  it('creates all required tables', () => {
    mkdirSync(testDir, { recursive: true });
    const db = new Database(testDir);
    const tables = db.raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name);
    expect(tables).toContain('projects');
    expect(tables).toContain('workflows');
    expect(tables).toContain('workflow_steps');
    expect(tables).toContain('agents');
    expect(tables).toContain('scenes');
    expect(tables).toContain('chapters');
    expect(tables).toContain('executions');
    expect(tables).toContain('execution_steps');
    expect(tables).toContain('entities');
    expect(tables).toContain('settings');

    const workflowColumns = db.raw
      .prepare("PRAGMA table_info(workflows)")
      .all() as Array<{ name: string }>;
    expect(workflowColumns.some((column) => column.name === 'kind')).toBe(true);
    db.close();
  });
});
