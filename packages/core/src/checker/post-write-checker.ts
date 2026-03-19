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
const SENTENCE_SPLIT = /[\u3002\uff1f\uff01]/;

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
  const locations = findMatches(paragraphs, /\u4e0d\u662f[^\uff0c\u3002\uff1f\uff01]{1,20}\u800c\u662f/g);
  if (locations.length >= 3) {
    return {
      rule: 'not-but-pattern',
      severity: 'warning',
      message: '\u201c\u4e0d\u662f\u2026\u2026\u800c\u662f\u2026\u2026\u201d\u53e5\u5f0f\u51fa\u73b0 ' + locations.length + ' \u6b21\uff08\u9608\u503c: 3\uff09\uff0c\u5efa\u8bae\u51cf\u5c11\u4f7f\u7528',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkDashFrequency(paragraphs: string[], text: string): CheckViolation | null {
  const count = countMatches(text, /\u2014\u2014/g);
  if (count >= 5) {
    const locations = findMatches(paragraphs, /\u2014\u2014/g);
    return {
      rule: 'dash-frequency',
      severity: 'warning',
      message: '\u7834\u6298\u53f7\uff08\u2014\u2014\uff09\u51fa\u73b0 ' + count + ' \u6b21\uff08\u9608\u503c: 5\uff09\uff0c\u5efa\u8bae\u51cf\u5c11\u4f7f\u7528',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkTransitionWords(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:\u7136\u800c|\u4f46\u662f|\u4e0d\u8fc7|\u5374)/g;
  const count = countMatches(text, pattern);
  if (count >= 8) {
    const locations = findMatches(paragraphs, /(?:\u7136\u800c|\u4f46\u662f|\u4e0d\u8fc7|\u5374)/g);
    return {
      rule: 'transition-words',
      severity: 'warning',
      message: '\u8f6c\u6298\u6807\u8bb0\u8bcd\uff08\u7136\u800c/\u4f46\u662f/\u4e0d\u8fc7/\u5374\uff09\u51fa\u73b0 ' + count + ' \u6b21\uff08\u9608\u503c: 8\uff09\uff0c\u5efa\u8bae\u51cf\u5c11\u4f7f\u7528',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkMetaNarrative(paragraphs: string[], _text: string): CheckViolation | null {
  const pattern = /(?:\u8fd9\u4e2a\u4e16\u754c|\u5728\u8fd9\u7247\u5927\u9646|\u5728\u8fd9\u4e2a\u4e16\u754c|\u8fd9\u7247\u5927\u9646\u4e0a)/g;
  const locations = findMatches(paragraphs, pattern);
  if (locations.length >= 1) {
    return {
      rule: 'meta-narrative',
      severity: 'error',
      message: '\u68c0\u6d4b\u5230\u5143\u53d9\u4e8b\u7528\u8bed\uff08\u4e0a\u5e1d\u89c6\u89d2\uff09\uff0c\u5171 ' + locations.length + ' \u5904\uff0c\u5fc5\u987b\u4fee\u590d',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkAcademicTone(paragraphs: string[], _text: string): CheckViolation | null {
  const pattern = /(?:\u672c\u8d28\u4e0a|\u4ece\u67d0\u79cd\u610f\u4e49\u4e0a|\u4ece\u672c\u8d28\u4e0a\u6765\u8bf4|\u5ba2\u89c2\u6765\u770b|\u4ece\u6839\u672c\u4e0a)/g;
  const locations = findMatches(paragraphs, pattern);
  if (locations.length >= 1) {
    return {
      rule: 'academic-tone',
      severity: 'error',
      message: '\u68c0\u6d4b\u5230\u5206\u6790\u672f\u8bed\uff08\u8bba\u6587\u8154\uff09\uff0c\u5171 ' + locations.length + ' \u5904\uff0c\u5fc5\u987b\u4fee\u590d',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkPreachyWords(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:\u5e94\u8be5|\u5fc5\u987b|\u4e0d\u5f97\u4e0d)/g;
  const count = countMatches(text, pattern);
  if (count >= 3) {
    const locations = findMatches(paragraphs, /(?:\u5e94\u8be5|\u5fc5\u987b|\u4e0d\u5f97\u4e0d)/g);
    return {
      rule: 'preachy-words',
      severity: 'warning',
      message: '\u8bf4\u6559\u8bcd\uff08\u5e94\u8be5/\u5fc5\u987b/\u4e0d\u5f97\u4e0d\uff09\u51fa\u73b0 ' + count + ' \u6b21\uff08\u9608\u503c: 3\uff09\uff0c\u5efa\u8bae\u51cf\u5c11\u4f7f\u7528',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkCollectiveShock(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:\u6240\u6709\u4eba\u90fd|\u4f17\u4eba\u7eb7\u7eb7|\u5728\u573a\u6240\u6709\u4eba|\u6240\u6709\u4eba\u7684\u76ee\u5149)/g;
  const count = countMatches(text, pattern);
  if (count >= 2) {
    const locations = findMatches(paragraphs, /(?:\u6240\u6709\u4eba\u90fd|\u4f17\u4eba\u7eb7\u7eb7|\u5728\u573a\u6240\u6709\u4eba|\u6240\u6709\u4eba\u7684\u76ee\u5149)/g);
    return {
      rule: 'collective-shock',
      severity: 'warning',
      message: '\u96c6\u4f53\u9707\u60ca\u7528\u8bed\u51fa\u73b0 ' + count + ' \u6b21\uff08\u9608\u503c: 2\uff09\uff0c\u5efa\u8bae\u51cf\u5c11\u4f7f\u7528',
      locations: [...new Set(locations)],
    };
  }
  return null;
}

function checkEmotionLabeling(paragraphs: string[], text: string): CheckViolation | null {
  const pattern = /(?:\u4ed6\u611f\u5230|\u5979\u611f\u5230|\u4ed6\u5fc3\u4e2d|\u5979\u5fc3\u4e2d|\u611f\u5230\u4e00\u9635|\u5fc3\u4e2d\u4e00\u9635|\u4ed6\u89c9\u5f97|\u5979\u89c9\u5f97)[^\n\uff0c\u3002]{0,6}(?:\u6124\u6012|\u559c\u60a6|\u60b2\u4f24|\u6050\u60e7|\u60ca\u8bb6|\u538c\u6076|\u7126\u8651|\u7d27\u5f20|\u5174\u594b|\u5931\u671b|\u7edd\u671b|\u6b23\u6170|\u4e0d\u5b89|\u6109\u60a6)/g;
  const count = countMatches(text, pattern);
  if (count >= 3) {
    const locations = findMatches(paragraphs, /(?:\u4ed6\u611f\u5230|\u5979\u611f\u5230|\u4ed6\u5fc3\u4e2d|\u5979\u5fc3\u4e2d|\u611f\u5230\u4e00\u9635|\u5fc3\u4e2d\u4e00\u9635|\u4ed6\u89c9\u5f97|\u5979\u89c9\u5f97)[^\n\uff0c\u3002]{0,6}(?:\u6124\u6012|\u559c\u60a6|\u60b2\u4f24|\u6050\u60e7|\u60ca\u8bb6|\u538c\u6076|\u7126\u8651|\u7d27\u5f20|\u5174\u594b|\u5931\u671b|\u7edd\u671b|\u6b23\u6170|\u4e0d\u5b89|\u6109\u60a6)/g);
    return {
      rule: 'emotion-labeling',
      severity: 'warning',
      message: '\u60c5\u7eea\u6807\u7b7e\uff08\u76f4\u63a5\u547d\u540d\u60c5\u7eea\uff09\u51fa\u73b0 ' + count + ' \u6b21\uff08\u9608\u503c: 3\uff09\uff0c\u5efa\u8bae\u7528\u884c\u4e3a/\u611f\u5b98\u63cf\u5199\u66ff\u4ee3',
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
      message: '\u68c0\u6d4b\u5230\u8fde\u7eed\u6bb5\u843d\u5b57\u6570\u8fc7\u4e8e\u63a5\u8fd1\uff08\u5dee\u5f02<15%\uff09\uff0c\u8282\u594f\u5355\u8c03',
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
      message: '\u68c0\u6d4b\u5230\u8fde\u7eed\u6bb5\u843d\u4ee5\u76f8\u540c\u8bcd\u5f00\u5934\uff0c\u5171 ' + [...new Set(locations)].length + ' \u4e2a\u6bb5\u843d',
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
    if (sentences[i].endsWith('\u4e86')) {
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
      message: '\u68c0\u6d4b\u5230\u8fde\u7eed \u22653 \u53e5\u4ee5\u201c\u4e86\u201d\u7ed3\u5c3e\uff0c\u8282\u594f\u62d6\u6c93',
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
    const lines: string[] = ['[\u786e\u5b9a\u6027\u68c0\u67e5\u5668\u8fdd\u89c4\u6e05\u5355]'];
    for (const e of errors) {
      lines.push('\u274c [' + e.rule + '] ' + e.message);
    }
    for (const w of warnings) {
      lines.push('\u26a0\ufe0f [' + w.rule + '] ' + w.message);
    }
    lines.push('\u8bf7\u5728\u6539\u5199\u65f6\u4f18\u5148\u4fee\u590d\u4ee5\u4e0a\u95ee\u9898\u3002');
    summary = lines.join(NL);
  }

  return { errors, warnings, summary };
}
