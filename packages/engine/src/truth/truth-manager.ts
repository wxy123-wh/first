// 真相文件管理器 — 读取/更新 truth/ 目录下的连续性管控文件

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoreManager } from '../store/store-manager.js';
import type { TruthFiles, SettlementData } from './types.js';

const NL = String.fromCharCode(10);

// ---- 模板 ----

const CURRENT_STATE_TEMPLATE = [
  '# 世界状态快照',
  '> 最后更新: 初始化',
  '',
  '## 主角状态',
  '- 位置: 未设定',
  '- 身体状态: 正常',
  '- 持有物品: 无',
  '',
  '## 关键NPC状态',
  '| NPC | 位置 | 状态 | 最后出现章节 |',
  '|-----|------|------|-------------|',
  '',
  '## 势力格局',
  '',
  '## 时间线',
  '| 章节 | 时间 | 事件 |',
  '|------|------|------|',
].join(NL);

const PENDING_HOOKS_TEMPLATE = [
  '# 伏笔追踪表',
  '> 最后更新: 初始化',
  '',
  '## 活跃伏笔',
  '| 编号 | 描述 | 埋设章节 | 预计回收 | 滞留标记 |',
  '|------|------|---------|---------|---------|',
  '',
  '## 已回收伏笔',
  '| 编号 | 描述 | 埋设章节 | 回收章节 |',
  '|------|------|---------|---------|',
].join(NL);

const CHARACTER_MATRIX_TEMPLATE = [
  '# 角色交互矩阵',
  '> 最后更新: 初始化',
  '',
  '## 信息边界',
  '| 角色 | 知道什么 | 不知道什么 |',
  '|------|---------|-----------|',
  '',
  '## 关系状态',
  '| 角色A | 角色B | 关系 | 最后交互章节 |',
  '|-------|-------|------|-------------|',
].join(NL);

/** 真相文件路径名 */
const FILE_NAMES = {
  currentState: 'current_state.md',
  pendingHooks: 'pending_hooks.md',
  characterMatrix: 'character_matrix.md',
} as const;

/**
 * TruthManager
 * 管理 truth/ 目录下的三个真相文件：
 * - current_state.md — 世界状态快照
 * - pending_hooks.md — 伏笔追踪表
 * - character_matrix.md — 角色交互矩阵
 */
export class TruthManager {
  constructor(
    private readonly store: StoreManager,
    private readonly projectId: string,
    private readonly truthDirName = 'truth',
  ) {}

  /** 读取全部真相文件 */
  async read(): Promise<TruthFiles> {
    const [currentState, pendingHooks, characterMatrix] = await Promise.all([
      this.readFileOrDefault(FILE_NAMES.currentState, CURRENT_STATE_TEMPLATE),
      this.readFileOrDefault(FILE_NAMES.pendingHooks, PENDING_HOOKS_TEMPLATE),
      this.readFileOrDefault(FILE_NAMES.characterMatrix, CHARACTER_MATRIX_TEMPLATE),
    ]);
    return { currentState, pendingHooks, characterMatrix };
  }

  /** 生成注入 prompt 的真相摘要（限制 2000 字） */
  async buildSummary(): Promise<string> {
    const files = await this.read();
    const sections = [
      '[真相文件摘要]',
      '',
      '--- 世界状态 ---',
      files.currentState,
      '',
      '--- 伏笔追踪 ---',
      files.pendingHooks,
      '',
      '--- 角色矩阵 ---',
      files.characterMatrix,
    ];
    const full = sections.join(NL);
    if (full.length > 2000) {
      return full.slice(0, 1997) + '...';
    }
    return full;
  }

  /** 用结算数据更新真相文件 */
  async applySettlement(settlement: SettlementData, chapterNumber: number): Promise<void> {
    const truthDir = this.getTruthDir();
    await mkdir(truthDir, { recursive: true });

    const files = await this.read();
    const chapterTag = '第' + chapterNumber + '章';

    // 更新世界状态
    files.currentState = this.applyWorldStateChanges(files.currentState, settlement, chapterTag);

    // 更新伏笔
    files.pendingHooks = this.applyHookChanges(files.pendingHooks, settlement, chapterNumber);

    // 更新角色矩阵
    files.characterMatrix = this.applyCharacterChanges(files.characterMatrix, settlement, chapterNumber);

    await Promise.all([
      writeFile(join(truthDir, FILE_NAMES.currentState), files.currentState, 'utf-8'),
      writeFile(join(truthDir, FILE_NAMES.pendingHooks), files.pendingHooks, 'utf-8'),
      writeFile(join(truthDir, FILE_NAMES.characterMatrix), files.characterMatrix, 'utf-8'),
    ]);
  }

  /** 扫描滞留伏笔（>10章未回收），返回标记数量 */
  async markStaleHooks(currentChapter: number): Promise<number> {
    const content = await this.readFileOrDefault(FILE_NAMES.pendingHooks, PENDING_HOOKS_TEMPLATE);
    const lines = content.split(NL);
    let marked = 0;

    const updated = lines.map((line) => {
      // 匹配活跃伏笔表格行: | 编号 | 描述 | 埋设章节 | 预计回收 | 滞留标记 |
      const match = line.match(/^\|\s*(\S+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*(\S*)\s*\|\s*(\S*)\s*\|$/);
      if (!match) return line;

      const plantedChapter = parseInt(match[3], 10);
      if (Number.isNaN(plantedChapter)) return line;

      const staleTag = match[5].trim();
      if (staleTag === '滞留' || staleTag === '滞留标记') return line; // 表头或已标记

      if (currentChapter - plantedChapter > 10) {
        marked++;
        return '| ' + match[1] + ' | ' + match[2] + ' | ' + match[3] + ' | ' + match[4] + ' | 滞留 |';
      }
      return line;
    });

    if (marked > 0) {
      await mkdir(this.getTruthDir(), { recursive: true });
      await writeFile(join(this.getTruthDir(), FILE_NAMES.pendingHooks), updated.join(NL), 'utf-8');
    }

    return marked;
  }

  /** 创建 truth/ 目录和模板文件（用于 init 命令） */
  async initTemplates(): Promise<void> {
    const truthDir = this.getTruthDir();
    await mkdir(truthDir, { recursive: true });
    await Promise.all([
      writeFile(join(truthDir, FILE_NAMES.currentState), CURRENT_STATE_TEMPLATE, 'utf-8'),
      writeFile(join(truthDir, FILE_NAMES.pendingHooks), PENDING_HOOKS_TEMPLATE, 'utf-8'),
      writeFile(join(truthDir, FILE_NAMES.characterMatrix), CHARACTER_MATRIX_TEMPLATE, 'utf-8'),
    ]);
  }

  // ---- 内部方法 ----

  private getTruthDir(): string {
    return this.store.resolveProjectPath(this.projectId, this.truthDirName);
  }

  private async readFileOrDefault(fileName: string, defaultContent: string): Promise<string> {
    try {
      return await readFile(join(this.getTruthDir(), fileName), 'utf-8');
    } catch {
      return defaultContent;
    }
  }

  private applyWorldStateChanges(content: string, settlement: SettlementData, chapterTag: string): string {
    // 更新"最后更新"标记
    let updated = content.replace(/> 最后更新:.+/, '> 最后更新: ' + chapterTag);

    // 追加世界状态变动到时间线
    for (const change of settlement.worldStateChanges) {
      const row = '| ' + chapterTag + ' | - | ' + change.description + ' |';
      updated += NL + row;
    }

    // 追加升级事件
    for (const evt of settlement.upgradeEvents) {
      const row = '| ' + chapterTag + ' | - | [升级] ' + evt.type + ': ' + evt.description + ' |';
      updated += NL + row;
    }

    return updated;
  }

  private applyHookChanges(content: string, settlement: SettlementData, chapterNumber: number): string {
    let updated = content.replace(/> 最后更新:.+/, '> 最后更新: 第' + chapterNumber + '章');

    for (const hook of settlement.hookChanges) {
      if (hook.action === 'plant') {
        // 新埋伏笔：追加到活跃伏笔表
        const hookId = hook.hookId ?? ('H' + chapterNumber + '-' + Date.now());
        const expected = hook.expectedResolution ? String(hook.expectedResolution) : '-';
        const row = '| ' + hookId + ' | ' + hook.description + ' | ' + chapterNumber + ' | ' + expected + ' |  |';
        // 插入到活跃伏笔表末尾（在"已回收伏笔"之前）
        const resolvedIdx = updated.indexOf('## 已回收伏笔');
        if (resolvedIdx > -1) {
          updated = updated.slice(0, resolvedIdx) + row + NL + NL + updated.slice(resolvedIdx);
        } else {
          updated += NL + row;
        }
      } else if (hook.action === 'resolve' && hook.hookId) {
        // 回收伏笔：从活跃表移到已回收表
        const lines = updated.split(NL);
        let removedRow = '';
        const filtered = lines.filter((line) => {
          if (line.includes('| ' + hook.hookId + ' |') || line.includes('| ' + hook.hookId + ' ')) {
            // 检查是否在活跃伏笔区域
            removedRow = line;
            return false;
          }
          return true;
        });
        updated = filtered.join(NL);

        if (removedRow) {
          // 从活跃行提取信息
          const parts = removedRow.split('|').map((s) => s.trim()).filter(Boolean);
          const resolvedRow = '| ' + (parts[0] ?? hook.hookId) + ' | ' + (parts[1] ?? hook.description) + ' | ' + (parts[2] ?? '-') + ' | ' + chapterNumber + ' |';
          updated += NL + resolvedRow;
        }
      }
    }

    return updated;
  }

  private applyCharacterChanges(content: string, settlement: SettlementData, chapterNumber: number): string {
    let updated = content.replace(/> 最后更新:.+/, '> 最后更新: 第' + chapterNumber + '章');

    for (const interaction of settlement.characterInteractions) {
      if (interaction.type === 'info_gain') {
        // 追加到信息边界表
        for (const char of interaction.characters) {
          const row = '| ' + char + ' | ' + interaction.description + ' |  |';
          // 插入到信息边界表末尾（在"关系状态"之前）
          const relationIdx = updated.indexOf('## 关系状态');
          if (relationIdx > -1) {
            updated = updated.slice(0, relationIdx) + row + NL + NL + updated.slice(relationIdx);
          } else {
            updated += NL + row;
          }
        }
      } else if (interaction.type === 'first_meet' || interaction.type === 'relation_change') {
        // 追加到关系状态表
        const chars = interaction.characters;
        if (chars.length >= 2) {
          const row = '| ' + chars[0] + ' | ' + chars[1] + ' | ' + interaction.description + ' | ' + chapterNumber + ' |';
          updated += NL + row;
        }
      }
    }

    return updated;
  }
}

// 导出模板常量（供 init 命令和测试使用）
export { CURRENT_STATE_TEMPLATE, PENDING_HOOKS_TEMPLATE, CHARACTER_MATRIX_TEMPLATE };
