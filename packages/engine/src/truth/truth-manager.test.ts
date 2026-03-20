// 真相文件管理器测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StoreManager } from '../store/store-manager.js';
import {
  TruthManager,
  CURRENT_STATE_TEMPLATE,
  PENDING_HOOKS_TEMPLATE,
  CHARACTER_MATRIX_TEMPLATE,
} from './truth-manager.js';
import type { SettlementData } from './types.js';

describe('TruthManager', () => {
  let workspaceDir: string;
  let projectDir: string;
  let store: StoreManager;
  let projectId: string;
  let manager: TruthManager;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'lisan-truth-workspace-'));
    projectDir = join(workspaceDir, 'project-a');
    await mkdir(projectDir, { recursive: true });

    store = new StoreManager(workspaceDir);
    projectId = store.createProject('truth-test', projectDir).id;
    manager = new TruthManager(store, projectId);
  });

  afterEach(async () => {
    store.close();
    await rm(workspaceDir, { recursive: true, force: true });
  });

  // ---- read ----
  describe('read', () => {
    it('文件不存在时返回默认模板', async () => {
      const files = await manager.read();
      expect(files.currentState).toBe(CURRENT_STATE_TEMPLATE);
      expect(files.pendingHooks).toBe(PENDING_HOOKS_TEMPLATE);
      expect(files.characterMatrix).toBe(CHARACTER_MATRIX_TEMPLATE);
    });

    it('文件存在时返回实际内容', async () => {
      await manager.initTemplates();
      const files = await manager.read();
      expect(files.currentState).toBe(CURRENT_STATE_TEMPLATE);
      expect(files.pendingHooks).toBe(PENDING_HOOKS_TEMPLATE);
      expect(files.characterMatrix).toBe(CHARACTER_MATRIX_TEMPLATE);
    });
  });

  // ---- initTemplates ----
  describe('initTemplates', () => {
    it('创建 project truth/ 目录和三个模板文件', async () => {
      await manager.initTemplates();

      const state = await readFile(join(projectDir, 'truth', 'current_state.md'), 'utf-8');
      const hooks = await readFile(join(projectDir, 'truth', 'pending_hooks.md'), 'utf-8');
      const matrix = await readFile(join(projectDir, 'truth', 'character_matrix.md'), 'utf-8');

      expect(state).toBe(CURRENT_STATE_TEMPLATE);
      expect(hooks).toBe(PENDING_HOOKS_TEMPLATE);
      expect(matrix).toBe(CHARACTER_MATRIX_TEMPLATE);
    });
  });

  // ---- buildSummary ----
  describe('buildSummary', () => {
    it('摘要包含三个文件的内容', async () => {
      const summary = await manager.buildSummary();
      expect(summary).toContain('真相文件摘要');
      expect(summary).toContain('世界状态');
      expect(summary).toContain('伏笔追踪');
      expect(summary).toContain('角色矩阵');
    });

    it('超长摘要截断到 2000 字', async () => {
      await manager.initTemplates();
      const longContent = '测试'.repeat(2000);
      await writeFile(join(projectDir, 'truth', 'current_state.md'), longContent, 'utf-8');
      const summary = await manager.buildSummary();
      expect(summary.length).toBeLessThanOrEqual(2000);
      expect(summary.endsWith('...')).toBe(true);
    });
  });

  // ---- applySettlement ----
  describe('applySettlement', () => {
    it('应用世界状态变动', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [],
        worldStateChanges: [
          { category: 'location', description: '主角移动到王城' },
        ],
        upgradeEvents: [
          { type: 'ability', description: '觉醒火系能力' },
        ],
      };
      await manager.applySettlement(settlement, 5);
      const files = await manager.read();
      expect(files.currentState).toContain('第5章');
      expect(files.currentState).toContain('主角移动到王城');
      expect(files.currentState).toContain('觉醒火系能力');
    });

    it('应用伏笔埋设', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H5-1', description: '神秘剑影', expectedResolution: 15 },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 5);
      const files = await manager.read();
      expect(files.pendingHooks).toContain('H5-1');
      expect(files.pendingHooks).toContain('神秘剑影');
      expect(files.pendingHooks).toContain('15');
    });

    it('应用伏笔回收', async () => {
      await manager.initTemplates();
      // 先埋伏笔
      const plant: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H3-1', description: '神秘信件' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(plant, 3);

      // 再回收
      const resolve: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'resolve', hookId: 'H3-1', description: '神秘信件揭开' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(resolve, 10);
      const files = await manager.read();
      // 已回收区域应包含回收章节
      expect(files.pendingHooks).toContain('10');
    });

    it('应用角色交互变动', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [
          { characters: ['主角', '小明'], type: 'first_meet', description: '初次相遇' },
          { characters: ['主角'], type: 'info_gain', description: '得知封印秘密' },
        ],
        hookChanges: [],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 7);
      const files = await manager.read();
      expect(files.characterMatrix).toContain('第7章');
      expect(files.characterMatrix).toContain('初次相遇');
      expect(files.characterMatrix).toContain('得知封印秘密');
    });
  });

  // ---- markStaleHooks ----
  describe('markStaleHooks', () => {
    it('标记滞留伏笔（>10章未回收）', async () => {
      await manager.initTemplates();
      // 埋设伏笔在第1章
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H1-1', description: '古老预言' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 1);

      // 在第15章检查滞留
      const marked = await manager.markStaleHooks(15);
      expect(marked).toBeGreaterThanOrEqual(1);

      const files = await manager.read();
      expect(files.pendingHooks).toContain('滞留');
    });

    it('未超过10章不标记', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H5-1', description: '近期伏笔' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 5);

      const marked = await manager.markStaleHooks(10);
      expect(marked).toBe(0);
    });
  });
});
