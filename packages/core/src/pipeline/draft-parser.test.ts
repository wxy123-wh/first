import { describe, it, expect } from 'vitest';
import { parseDraftOutput } from './draft-parser.js';

describe('parseDraftOutput', () => {
  it('正常解析三阶段输出', () => {
    const raw = `
\`\`\`pre-check
上下文确认：场景A、场景B
世界状态核对：主角在城内
\`\`\`

\`\`\`chapter
第一章正文内容
\`\`\`

\`\`\`settlement
{
  "characterInteractions": [{"characters": ["A", "B"], "type": "first_meet", "description": "初次见面"}],
  "hookChanges": [],
  "worldStateChanges": [],
  "upgradeEvents": []
}
\`\`\`
`;

    const result = parseDraftOutput(raw);
    expect(result.preCheck).toContain('上下文确认');
    expect(result.chapter).toBe('第一章正文内容');
    expect(result.settlement.characterInteractions).toHaveLength(1);
  });

  it('缺少 pre-check 块时降级处理', () => {
    const raw = `
\`\`\`chapter
正文内容
\`\`\`

\`\`\`settlement
{"characterInteractions": [], "hookChanges": [], "worldStateChanges": [], "upgradeEvents": []}
\`\`\`
`;

    const result = parseDraftOutput(raw);
    expect(result.preCheck).toBe('');
    expect(result.chapter).toBe('正文内容');
  });

  it('缺少 settlement 块时使用空结算', () => {
    const raw = `
\`\`\`chapter
正文内容
\`\`\`
`;

    const result = parseDraftOutput(raw);
    expect(result.settlement.characterInteractions).toEqual([]);
    expect(result.settlement.hookChanges).toEqual([]);
  });

  it('settlement JSON 格式错误时容错', () => {
    const raw = `
\`\`\`chapter
正文内容
\`\`\`

\`\`\`settlement
{invalid json}
\`\`\`
`;

    const result = parseDraftOutput(raw);
    expect(result.settlement.characterInteractions).toEqual([]);
  });

  it('缺少所有围栏时将整个输出视为正文', () => {
    const raw = '纯文本正文内容';

    const result = parseDraftOutput(raw);
    expect(result.preCheck).toBe('');
    expect(result.chapter).toBe('纯文本正文内容');
    expect(result.settlement.characterInteractions).toEqual([]);
  });

  it('处理多行 pre-check 和 chapter', () => {
    const raw = `
\`\`\`pre-check
第一行检查
第二行检查
第三行检查
\`\`\`

\`\`\`chapter
第一段正文

第二段正文
\`\`\`

\`\`\`settlement
{"characterInteractions": [], "hookChanges": [], "worldStateChanges": [], "upgradeEvents": []}
\`\`\`
`;

    const result = parseDraftOutput(raw);
    expect(result.preCheck).toContain('第一行检查');
    expect(result.preCheck).toContain('第三行检查');
    expect(result.chapter).toContain('第一段正文');
    expect(result.chapter).toContain('第二段正文');
  });
});
