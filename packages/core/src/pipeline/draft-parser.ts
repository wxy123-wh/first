import type { SettlementData } from '../truth/types.js';

export interface DraftParseResult {
  preCheck: string;
  chapter: string;
  settlement: SettlementData;
}

/**
 * 从 Draft Agent 三阶段输出中解析各块
 * 使用围栏代码块标记分割：```pre-check、```chapter、```settlement
 */
export function parseDraftOutput(raw: string): DraftParseResult {
  const preCheckMatch = raw.match(/```pre-check\s*\n([\s\S]*?)\n```/);
  const chapterMatch = raw.match(/```chapter\s*\n([\s\S]*?)\n```/);
  const settlementMatch = raw.match(/```settlement\s*\n([\s\S]*?)\n```/);

  const preCheck = preCheckMatch?.[1]?.trim() || '';
  const chapter = chapterMatch?.[1]?.trim() || raw.trim();
  
  let settlement: SettlementData = {
    characterInteractions: [],
    hookChanges: [],
    worldStateChanges: [],
    upgradeEvents: [],
  };

  if (settlementMatch?.[1]) {
    try {
      settlement = JSON.parse(settlementMatch[1].trim());
    } catch {
      // 降级处理：JSON 解析失败时使用空结算
    }
  }

  return { preCheck, chapter, settlement };
}
