import { describe, expect, it } from "vitest";
import { getRagSyncState } from "./rag-sync-state";

describe("rag sync state", () => {
  it("marks rag sync as unavailable in current desktop version", () => {
    const state = getRagSyncState();

    expect(state.available).toBe(false);
    expect(state.title).toBe("当前版本不可用");
    expect(state.reason).toContain("暂未接入");
    expect(state.actionLabel).toBe("功能建设中");
  });
});
