import { describe, expect, it } from "vitest";
import { getRagSyncState } from "./rag-sync-state";

describe("rag sync state", () => {
  it("marks rag sync as available in desktop", () => {
    const state = getRagSyncState();

    expect(state.available).toBe(true);
    expect(state.title).toBe("已接入执行链路");
    expect(state.reason).toContain("成功/失败统计");
    expect(state.actionLabel).toBe("开始同步");
  });
});
