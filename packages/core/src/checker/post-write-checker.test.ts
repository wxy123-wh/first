// 确定性后验证器测试

import { describe, it, expect } from 'vitest';
import { checkDraft } from './post-write-checker.js';

const nl = String.fromCharCode(10);
const nlnl = nl + nl;

describe('post-write-checker', () => {
  // ---- not-but-pattern ----
  describe('not-but-pattern', () => {
    it('触发：≥3 次"不是……而是……"', () => {
      const draft = [
        '这不是普通的力量而是来自深渊的馈赠。',
        '',
        '他不是害怕而是在等待时机。',
        '',
        '她不是软弱而是隐忍。',
      ].join(nl);
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'not-but-pattern');
      expect(v).toBeDefined();
      expect(v!.severity).toBe('warning');
    });

    it('不触发：<3 次', () => {
      const draft = '这不是普通的力量而是来自深渊的馈赠。' + nlnl + '他站在原地一动不动。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'not-but-pattern');
      expect(v).toBeUndefined();
    });
  });

  // ---- dash-frequency ----
  describe('dash-frequency', () => {
    it('触发：≥5 次破折号', () => {
      const parts = ['他\u2014\u2014不', '\u2014\u2014她', '\u2014\u2014也', '\u2014\u2014还有', '\u2014\u2014都在这里。'];
      const draft = parts.join('');
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'dash-frequency');
      expect(v).toBeDefined();
    });

    it('不触发：<5 次', () => {
      const draft = '他\u2014\u2014停下了脚步\u2014\u2014然后转身。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'dash-frequency');
      expect(v).toBeUndefined();
    });
  });

  // ---- transition-words ----
  describe('transition-words', () => {
    it('触发：≥8 次转折词', () => {
      const words = ['然而', '但是', '不过', '却', '然而', '但是', '不过', '却'];
      const draft = words.map((w) => w + '他没有停下。').join(nlnl);
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'transition-words');
      expect(v).toBeDefined();
    });

    it('不触发：<8 次', () => {
      const draft = '然而他没有停下。但是她追了上来。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'transition-words');
      expect(v).toBeUndefined();
    });
  });

  // ---- meta-narrative ----
  describe('meta-narrative', () => {
    it('触发：检测到元叙事', () => {
      const draft = '在这个世界上，强者为尊。';
      const result = checkDraft(draft);
      const v = result.errors.find((e) => e.rule === 'meta-narrative');
      expect(v).toBeDefined();
      expect(v!.severity).toBe('error');
    });

    it('不触发：无元叙事', () => {
      const draft = '他走在街道上，四周一片寂静。';
      const result = checkDraft(draft);
      const v = result.errors.find((e) => e.rule === 'meta-narrative');
      expect(v).toBeUndefined();
    });
  });

  // ---- academic-tone ----
  describe('academic-tone', () => {
    it('触发：检测到论文腔', () => {
      const draft = '本质上，这场战斗的胜负早已注定。';
      const result = checkDraft(draft);
      const v = result.errors.find((e) => e.rule === 'academic-tone');
      expect(v).toBeDefined();
      expect(v!.severity).toBe('error');
    });

    it('不触发：无论文腔', () => {
      const draft = '这场战斗的胜负早已注定。';
      const result = checkDraft(draft);
      const v = result.errors.find((e) => e.rule === 'academic-tone');
      expect(v).toBeUndefined();
    });
  });

  // ---- preachy-words ----
  describe('preachy-words', () => {
    it('触发：≥3 次说教词', () => {
      const draft = '你应该明白。你必须坚强。你不得不面对。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'preachy-words');
      expect(v).toBeDefined();
    });

    it('不触发：<3 次', () => {
      const draft = '你应该明白这一点。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'preachy-words');
      expect(v).toBeUndefined();
    });
  });

  // ---- collective-shock ----
  describe('collective-shock', () => {
    it('触发：≥2 次集体震惊', () => {
      const draft = '所有人都震惊了。' + nlnl + '众人纷纷后退。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'collective-shock');
      expect(v).toBeDefined();
    });

    it('不触发：<2 次', () => {
      const draft = '所有人都安静了下来。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'collective-shock');
      expect(v).toBeUndefined();
    });
  });

  // ---- emotion-labeling ----
  describe('emotion-labeling', () => {
    it('触发：≥3 次情绪标签', () => {
      const draft = [
        '他感到愤怒，拳头握紧。',
        '',
        '她心中一阵悲伤。',
        '',
        '他觉得恐惧蔓延开来。',
      ].join(nl);
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'emotion-labeling');
      expect(v).toBeDefined();
    });

    it('不触发：<3 次', () => {
      const draft = '他感到愤怒，拳头握紧。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'emotion-labeling');
      expect(v).toBeUndefined();
    });
  });

  // ---- equal-paragraphs ----
  describe('equal-paragraphs', () => {
    it('触发：连续 3 段字数接近', () => {
      const draft = [
        '他站在原地不动了。',
        '',
        '她看着远方沉默着。',
        '',
        '风吹过来很冷的。',
      ].join(nl);
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'equal-paragraphs');
      expect(v).toBeDefined();
    });

    it('不触发：段落长度差异大', () => {
      const draft = [
        '短。',
        '',
        '这是一段非常非常非常非常非常非常非常非常非常长的段落，包含了大量的描写和细节。',
        '',
        '中等长度的段落。',
      ].join(nl);
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'equal-paragraphs');
      expect(v).toBeUndefined();
    });
  });

  // ---- same-start ----
  describe('same-start', () => {
    it('触发：连续段落相同开头', () => {
      const draft = '他走到门前停下。' + nlnl + '他走进了房间。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'same-start');
      expect(v).toBeDefined();
    });

    it('不触发：不同开头', () => {
      const draft = '他走到门前停下。' + nlnl + '她转过身来。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'same-start');
      expect(v).toBeUndefined();
    });
  });

  // ---- trailing-le ----
  describe('trailing-le', () => {
    it('触发：连续 ≥3 句以"了"结尾', () => {
      const draft = '他站起来了。她走过来了。门关上了。窗户也关了。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'trailing-le');
      expect(v).toBeDefined();
    });

    it('不触发：无连续"了"', () => {
      const draft = '他站起来了。她走过来。门关上了。';
      const result = checkDraft(draft);
      const v = result.warnings.find((w) => w.rule === 'trailing-le');
      expect(v).toBeUndefined();
    });
  });

  // ---- summary 生成 ----
  describe('summary', () => {
    it('无违规时 summary 为空字符串', () => {
      const draft = '他走在路上，四周一片寂静。微风拂过脸颊。';
      const result = checkDraft(draft);
      expect(result.summary).toBe('');
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('有违规时 summary 包含规则 ID', () => {
      const draft = '本质上，在这个世界里，强者为尊。';
      const result = checkDraft(draft);
      expect(result.summary).toContain('meta-narrative');
      expect(result.summary).toContain('academic-tone');
      expect(result.summary).toContain('\u786e\u5b9a\u6027\u68c0\u67e5\u5668\u8fdd\u89c4\u6e05\u5355');
    });
  });
});
