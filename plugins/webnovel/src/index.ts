// @lisan/plugin-webnovel — 网文写作插件（血色天平风格包）

import type { BookConfig, LisanPlugin, Pass } from '@lisan/core';

/** 血色天平风格配置 */
const webnovelBookConfig: BookConfig = {
  id: 'webnovel',
  title: '血色天平',
  genre: '都市异能',
  targetWordCount: 2_000_000,
  chapterWordRange: [3000, 4000],
  thrillTypes: ['怒火宣泄', '悲剧', '智商碾压', '战斗快感'],
  protagonistId: 'protagonist',
  cameraRules: '锁定主角体内视角，禁止全知旁白，禁止上帝视角情绪引导',
  sensorPriority: ['触觉', '听觉', '视觉', '嗅觉', '味觉'],
  antiAiWordlist: [
    '不禁', '竟然', '居然', '仿佛', '宛如', '犹如',
    '不由得', '情不自禁', '与此同时', '值得一提的是',
    '毫无疑问', '显而易见', '不言而喻', '众所周知',
  ],
  passDefinitions: [
    { id: 'pass-1-experience', name: '体验植入', agentId: 'rewrite-pass-1', order: 1 },
    { id: 'pass-2-thrill-boost', name: '爽点强化', agentId: 'rewrite-pass-2', order: 2 },
    { id: 'pass-3-rhythm', name: '节奏张力', agentId: 'rewrite-pass-3', order: 3 },
    { id: 'pass-4-dialogue', name: '对话博弈', agentId: 'rewrite-pass-4', order: 4 },
    { id: 'pass-5-anti-ai', name: 'Anti-AI 终检', agentId: 'rewrite-pass-5', order: 5 },
  ],
  agentDefinitions: [
    {
      id: 'context-agent',
      name: 'Context Agent',
      systemPrompt: '你是场景驱动的上下文组装专家。{{instructions}}',
      model: 'claude-opus-4-6',
      timeoutMs: 300_000,
      temperature: 0.3,
    },
    {
      id: 'draft-agent',
      name: '起草 Agent',
      systemPrompt: '你是网文正文起草专家。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.85,
    },
    {
      id: 'rewrite-pass-1',
      name: '体验植入 Pass',
      systemPrompt: '你是体验植入专家。将全知旁白转为角色感官，情绪形容词转为生理反应。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.8,
    },
    {
      id: 'rewrite-pass-2',
      name: '爽点强化 Pass',
      systemPrompt: '你是爽点强化专家。压制段压更狠，释放点炸更响。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.8,
    },
    {
      id: 'rewrite-pass-3',
      name: '节奏张力 Pass',
      systemPrompt: '你是节奏张力专家。控制句长分布，制造速度差。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.75,
    },
    {
      id: 'rewrite-pass-4',
      name: '对话博弈 Pass',
      systemPrompt: '你是对话博弈专家。信息直给转半句话+暗示，角色语言差异化。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.8,
    },
    {
      id: 'rewrite-pass-5',
      name: 'Anti-AI 终检 Pass',
      systemPrompt: '你是 Anti-AI 终检专家。七层扫描消灭 AI 痕迹。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.7,
    },
    {
      id: 'review-agent',
      name: '终审 Agent',
      systemPrompt: '你是终审专家。场景完成度审查 + 体验审查 + 直接修复。{{instructions}}',
      model: 'claude-opus-4-6',
      timeoutMs: 300_000,
      temperature: 0.5,
    },
    {
      id: 'data-agent',
      name: 'Data Agent',
      systemPrompt: '你是数据处理专家。实体提取 + 章节摘要 + 向量嵌入。{{instructions}}',
      model: 'gpt-4o',
      temperature: 0.3,
    },
  ],
};

/** 网文写作插件 */
export const webnovelPlugin: LisanPlugin = {
  id: 'webnovel',
  bookConfig: webnovelBookConfig,
  createPass(_passId: string): Pass | null {
    // 默认不覆盖，使用系统默认 Pass 实现
    return null;
  },
};

export default webnovelPlugin;
