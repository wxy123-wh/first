// 确定性后验证器 — 零 LLM 成本的规则检查
// 在 Draft Agent 输出初稿后、Pass 改写链之前执行

/** 单条违规 */
export interface CheckViolation {
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  locations: number[];
}

/** 检查结果 */
export interface CheckResult {
  errors: CheckViolation[];
  warnings: CheckViolation[];
  /** 注入 Pass prompt 的摘要文本，无违规时为空字符串 */
  summary: string;
}

// ---- 内部工具 ----

const NL = String.fromCharCode(10);
const PARA_SPLIT = new RegExp(NL + '{2,}');
const SENTENCE_SPLIT = /[。？！]/;

/** 按空行分段 */
function splitParagraphs(text: string): string[] {
  return text.split(PARA_SPLIT).map((p) => p.trim()).filter(Boolean);
}

/** 按句号/问号/感叹号分句 */
function splitSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

/** 统计正则匹配次数，返回匹配所在段落索引 */
function findMatches(paragraphs: string[], pattern: RegExp): number[] {
  const locations: number[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const matches = paragraphs[i].match(pattern);
    if (matches) {
      for (let j = 0; j < matches.length; j++) {
        locations.push(i);
      }
    }
  }
  return locations;
}

/** 统计正则在全文中的匹配总数 */
function countMatches(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  return m ? m.length : 0;
}

// ---- 11 条规则 ----

function checkNotButPattern(paragraphs: string[], _text: string): CheckViolation | null {
  const locations = findMatches(paragraphs, /不是[^，。？！]{1,20}而是/g);
  if (locations.length >= 3) {
    return {
      rule: 'not-but-pattern',
      severity: 'warning',
      message: '“不是……而是……”句式出现 ' + locations.length + ' 次（阈值: 3），建议减少使用',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkDashFrequency(paragraphs: string[], text: string): CheckViolation | null {
  const count = countMatches(text, /——/g);
  if (count >= 5) {
    const locations = findMatches(paragraphs, /——/g);
    return {
      rule: 'dash-frequency',
      severity: 'warning',
      message: '破折号（——）出现 ' + count + ' 次（阈值: 5），建议减少使用',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkTransitionWords(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:然而|但是|不过|却)/g;
  const count = countMatches(text, pattern);
  if (count >= 8) {
    const locations = findMatches(paragraphs, /(?:然而|但是|不过|却)/g);
    return {
      rule: 'transition-words',
      severity: 'warning',
      message: '转折标记词（然而/但是/不过/却）出现 ' + count + ' 次（阈值: 8），建议减少使用',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkMetaNarrative(paragraphs: string[], _text: string): CheckViolation | null {
  const pattern = /(?:这个世界|在这片大陆|在这个世界|这片大陆上)/g;
  const locations = findMatches(paragraphs, pattern);
  if (locations.length >= 1) {
    return {
      rule: 'meta-narrative',
      severity: 'error',
      message: '检测到元叙事用语（上帝视角），共 ' + locations.length + ' 处，必须修复',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkAcademicTone(paragraphs: string[], _text: string): CheckViolation | null {
  const pattern = /(?:本质上|从某种意义上|从本质上来说|客观来看|从根本上)/g;
  const locations = findMatches(paragraphs, pattern);
  if (locations.length >= 1) {
    return {
      rule: 'academic-tone',
      severity: 'error',
      message: '检测到分析术语（论文腔），共 ' + locations.length + ' 处，必须修复',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkPreachyWords(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:应该|必须|不得不)/g;
  const count = countMatches(text, pattern);
  if (count >= 3) {
    const locations = findMatches(paragraphs, /(?:应该|必须|不得不)/g);
    return {
      rule: 'preachy-words',
      severity: 'warning',
      message: '说教词（应该/必须/不得不）出现 ' + count + ' 次（阈值: 3），建议减少使用',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkCollectiveShock(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:所有人都|众人纷纷|在场所有人|所有人的目光)/g;
  const count = countMatches(text, pattern);
  if (count >= 2) {
    const locations = findMatches(paragraphs, /(?:所有人都|众人纷纷|在场所有人|所有人的目光)/g);
    return {
      rule: 'collective-shock',
      severity: 'warning',
      message: '集体震惊用语出现 ' + count + ' 次（阈值: 2），建议减少使用',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkEmotionLabeling(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:他感到|她感到|他心中|她心中|感到一阵|心中一阵|他觉得|她觉得)[^\n，。]{0,6}(?:愤怒|喜悦|悲伤|恐惧|惊讶|厌恶|焦虑|紧张|兴奋|失望|绝望|欣慰|不安|愉悦)/g;
  const count = countMatches(text, pattern);
  if (count >= 3) {
    const locations = findMatches(paragraphs, /(?:他感到|她感到|他心中|她心中|感到一阵|心中一阵|他觉得|她觉得)[^\n，。]{0,6}(?:愤怒|喜悦|悲伤|恐惧|惊讶|厌恶|焦虑|紧张|兴奋|失望|绝望|欣慰|不安|愉悦)/g);
    return {
      rule: 'emotion-labeling',
      severity: 'warning',
      message: '情绪标签（直接命名情绪）出现 ' + count + ' 次（阈值: 3），建议用行为/感官描写替代',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkEqualParagraphs(paragraphs: string[], _text: string): CheckViolation | null {
  const locations: number[] = [];
  for (let i = 0; i <= paragraphs.length - 3; i++) {
    const lens = [paragraphs[i].length, paragraphs[i + 1].length, paragraphs[i + 2].length];
    const avg = (lens[0] + lens[1] + lens[2]) / 3;
    if (avg === 0) continue;
    const allClose = lens.every((l) => Math.abs(l - avg) / avg < 0.15);
    if (allClose) {
      locations.push(i, i + 1, i + 2);
    }
  }
  if (locations.length > 0) {
    return {
      rule: 'equal-paragraphs',
      severity: 'warning',
      message: '检测到连续段落字数过于接近（差异<15%），节奏单调',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkSameStart(paragraphs: string[], _text: string): CheckViolation | null {
  const locations: number[] = [];
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const a = paragraphs[i];
    const b = paragraphs[i + 1];
    if (a.length >= 2 && b.length >= 2 && a.slice(0, 2) === b.slice(0, 2)) {
      locations.push(i, i + 1);
    }
  }
  if (locations.length > 0) {
    return {
      rule: 'same-start',
      severity: 'warning',
      message: '检测到连续段落以相同词开头，共 ' + [...new Set(locations)].length + ' 个段落',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkTrailingLe(paragraphs: string[], text: string): CheckViolation | null {
  const sentences = splitSentences(text);
  const locations: number[] = [];
  let consecutive = 0;
  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i].endsWith('了')) {
      consecutive++;
      if (consecutive >= 3) {
        for (let p = 0; p < paragraphs.length; p++) {
          if (paragraphs[p].includes(sentences[i])) {
            locations.push(p);
          }
        }
      }
    } else {
      consecutive = 0;
    }
  }
  if (locations.length > 0) {
    return {
      rule: 'trailing-le',
      severity: 'warning',
      message: '检测到连续 ≥3 句以“了”结尾，节奏拖沓',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

// ---- 主入口 ----

const allCheckers = [
  checkNotButPattern,
  checkDashFrequency,
  checkTransitionWords,
  checkMetaNarrative,
  checkAcademicTone,
  checkPreachyWords,
  checkCollectiveShock,
  checkEmotionLabeling,
  checkEqualParagraphs,
  checkSameStart,
  checkTrailingLe,
];

/**
 * 对初稿执行确定性规则检查
 * @param draft 初稿文本
 * @returns 检查结果，包含 errors/warnings 和注入 Pass prompt 的摘要
 */
export function checkDraft(draft: string): CheckResult {
  const paragraphs = splitParagraphs(draft);
  const errors: CheckViolation[] = [];
  const warnings: CheckViolation[] = [];

  for (const checker of allCheckers) {
    const violation = checker(paragraphs, draft);
    if (violation) {
      if (violation.severity === 'error') {
        errors.push(violation);
      } else {
        warnings.push(violation);
      }
    }
  }

  let summary = '';
  if (errors.length > 0 || warnings.length > 0) {
    const lines: string[] = ['[确定性检查器违规清单]'];
    for (const e of errors) {
      lines.push('❌ [' + e.rule + '] ' + e.message);
    }
    for (const w of warnings) {
      lines.push('⚠️ [' + w.rule + '] ' + w.message);
    }
    lines.push('请在改写时优先修复以上问题。');
    summary = lines.join(NL);
  }

  return { errors, warnings, summary };
}
