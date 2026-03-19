// 真相文件管理器测试

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TruthManager,
  CURRENT_STATE_TEMPLATE,
  PENDING_HOOKS_TEMPLATE,
  CHARACTER_MATRIX_TEMPLATE,
} from './truth-manager.js';
import type { SettlementData } from './types.js';

const NL = String.fromCharCode(10);

describe('TruthManager', () => {
  let tempDir: string;
  let manager: TruthManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lisan-truth-'));
    manager = new TruthManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---- read ----
  describe('read', () => {
    it('\u6587\u4ef6\u4e0d\u5b58\u5728\u65f6\u8fd4\u56de\u9ed8\u8ba4\u6a21\u677f', async () => {
      const files = await manager.read();
      expect(files.currentState).toBe(CURRENT_STATE_TEMPLATE);
      expect(files.pendingHooks).toBe(PENDING_HOOKS_TEMPLATE);
      expect(files.characterMatrix).toBe(CHARACTER_MATRIX_TEMPLATE);
    });

    it('\u6587\u4ef6\u5b58\u5728\u65f6\u8fd4\u56de\u5b9e\u9645\u5185\u5bb9', async () => {
      await manager.initTemplates();
      const files = await manager.read();
      expect(files.currentState).toBe(CURRENT_STATE_TEMPLATE);
      expect(files.pendingHooks).toBe(PENDING_HOOKS_TEMPLATE);
      expect(files.characterMatrix).toBe(CHARACTER_MATRIX_TEMPLATE);
    });
  });

  // ---- initTemplates ----
  describe('initTemplates', () => {
    it('\u521b\u5efa truth/ \u76ee\u5f55\u548c\u4e09\u4e2a\u6a21\u677f\u6587\u4ef6', async () => {
      await manager.initTemplates();
      const state = await readFile(join(tempDir, 'truth', 'current_state.md'), 'utf-8');
      const hooks = await readFile(join(tempDir, 'truth', 'pending_hooks.md'), 'utf-8');
      const matrix = await readFile(join(tempDir, 'truth', 'character_matrix.md'), 'utf-8');
      expect(state).toBe(CURRENT_STATE_TEMPLATE);
      expect(hooks).toBe(PENDING_HOOKS_TEMPLATE);
      expect(matrix).toBe(CHARACTER_MATRIX_TEMPLATE);
    });
  });

  // ---- buildSummary ----
  describe('buildSummary', () => {
    it('\u6458\u8981\u5305\u542b\u4e09\u4e2a\u6587\u4ef6\u7684\u5185\u5bb9', async () => {
      const summary = await manager.buildSummary();
      expect(summary).toContain('\u771f\u76f8\u6587\u4ef6\u6458\u8981');
      expect(summary).toContain('\u4e16\u754c\u72b6\u6001');
      expect(summary).toContain('\u4f0f\u7b14\u8ffd\u8e2a');
      expect(summary).toContain('\u89d2\u8272\u77e9\u9635');
    });

    it('\u8d85\u957f\u6458\u8981\u622a\u65ad\u5230 2000 \u5b57', async () => {
      await manager.initTemplates();
      // \u5199\u5165\u8d85\u957f\u5185\u5bb9
      const { writeFile: wf } = await import('node:fs/promises');
      const longContent = '\u6d4b\u8bd5'.repeat(2000);
      await wf(join(tempDir, 'truth', 'current_state.md'), longContent, 'utf-8');
      const summary = await manager.buildSummary();
      expect(summary.length).toBeLessThanOrEqual(2000);
      expect(summary.endsWith('...')).toBe(true);
    });
  });

  // ---- applySettlement ----
  describe('applySettlement', () => {
    it('\u5e94\u7528\u4e16\u754c\u72b6\u6001\u53d8\u52a8', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [],
        worldStateChanges: [
          { category: 'location', description: '\u4e3b\u89d2\u79fb\u52a8\u5230\u738b\u57ce' },
        ],
        upgradeEvents: [
          { type: 'ability', description: '\u89c9\u9192\u706b\u7cfb\u80fd\u529b' },
        ],
      };
      await manager.applySettlement(settlement, 5);
      const files = await manager.read();
      expect(files.currentState).toContain('\u7b2c5\u7ae0');
      expect(files.currentState).toContain('\u4e3b\u89d2\u79fb\u52a8\u5230\u738b\u57ce');
      expect(files.currentState).toContain('\u89c9\u9192\u706b\u7cfb\u80fd\u529b');
    });

    it('\u5e94\u7528\u4f0f\u7b14\u57cb\u8bbe', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H5-1', description: '\u795e\u79d8\u5251\u5f71', expectedResolution: 15 },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 5);
      const files = await manager.read();
      expect(files.pendingHooks).toContain('H5-1');
      expect(files.pendingHooks).toContain('\u795e\u79d8\u5251\u5f71');
      expect(files.pendingHooks).toContain('15');
    });

    it('\u5e94\u7528\u4f0f\u7b14\u56de\u6536', async () => {
      await manager.initTemplates();
      // \u5148\u57cb\u4f0f\u7b14
      const plant: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H3-1', description: '\u795e\u79d8\u4fe1\u4ef6' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(plant, 3);

      // \u518d\u56de\u6536
      const resolve: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'resolve', hookId: 'H3-1', description: '\u795e\u79d8\u4fe1\u4ef6\u63ed\u5f00' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(resolve, 10);
      const files = await manager.read();
      // \u5df2\u56de\u6536\u533a\u57df\u5e94\u5305\u542b\u56de\u6536\u7ae0\u8282
      expect(files.pendingHooks).toContain('10');
    });

    it('\u5e94\u7528\u89d2\u8272\u4ea4\u4e92\u53d8\u52a8', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [
          { characters: ['\u4e3b\u89d2', '\u5c0f\u660e'], type: 'first_meet', description: '\u521d\u6b21\u76f8\u9047' },
          { characters: ['\u4e3b\u89d2'], type: 'info_gain', description: '\u5f97\u77e5\u5c01\u5370\u79d8\u5bc6' },
        ],
        hookChanges: [],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 7);
      const files = await manager.read();
      expect(files.characterMatrix).toContain('\u7b2c7\u7ae0');
      expect(files.characterMatrix).toContain('\u521d\u6b21\u76f8\u9047');
      expect(files.characterMatrix).toContain('\u5f97\u77e5\u5c01\u5370\u79d8\u5bc6');
    });
  });

  // ---- markStaleHooks ----
  describe('markStaleHooks', () => {
    it('\u6807\u8bb0\u6ede\u7559\u4f0f\u7b14\uff08>10\u7ae0\u672a\u56de\u6536\uff09', async () => {
      await manager.initTemplates();
      // \u57cb\u8bbe\u4f0f\u7b14\u5728\u7b2c1\u7ae0
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H1-1', description: '\u53e4\u8001\u9884\u8a00' },
        ],
        worldStateChanges: [],
        upgradeEvents: [],
      };
      await manager.applySettlement(settlement, 1);

      // \u5728\u7b2c15\u7ae0\u68c0\u67e5\u6ede\u7559
      const marked = await manager.markStaleHooks(15);
      expect(marked).toBeGreaterThanOrEqual(1);

      const files = await manager.read();
      expect(files.pendingHooks).toContain('\u6ede\u7559');
    });

    it('\u672a\u8d85\u8fc710\u7ae0\u4e0d\u6807\u8bb0', async () => {
      await manager.initTemplates();
      const settlement: SettlementData = {
        characterInteractions: [],
        hookChanges: [
          { action: 'plant', hookId: 'H5-1', description: '\u8fd1\u671f\u4f0f\u7b14' },
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
