// 追踪日志写入器

import { appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { TraceEvent, TraceEventType } from './types.js';

/** 追踪日志写入器 */
export class TraceWriter {
  private readonly logPath: string;

  constructor(projectRoot: string) {
    this.logPath = join(projectRoot, '.lisan', 'observability', 'trace.jsonl');
  }

  /** 写入追踪事件 */
  async write(event: TraceEvent): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    const newline = String.fromCharCode(10);
    const line = JSON.stringify(event) + newline;
    await appendFile(this.logPath, line, 'utf-8');
  }

  /** 创建追踪事件的便捷方法 */
  createEvent(
    traceId: string,
    event: TraceEventType,
    payload: Record<string, unknown>,
  ): TraceEvent {
    return {
      timestamp: new Date().toISOString(),
      traceId,
      event,
      payload,
    };
  }
}
