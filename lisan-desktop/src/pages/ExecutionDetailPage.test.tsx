import { describe, expect, it } from "vitest";
import type { ExecutionStatus, WorkflowNotification } from "@/types/engine";
import { shouldRefreshExecutionDetail, syncExecutionStatusFromEvent } from "./ExecutionDetailPage";

function buildEvent(
  method: WorkflowNotification["method"],
  params: WorkflowNotification["params"] = null,
): WorkflowNotification {
  return {
    method,
    params,
    receivedAt: "2026-03-22T00:00:00.000Z",
  };
}

describe("ExecutionDetailPage event sync", () => {
  it("marks execution as failed when receiving step:failed", () => {
    expect(
      syncExecutionStatusFromEvent(
        "running",
        buildEvent("step:failed", {
          executionId: "exec-1",
          stepId: "step-1",
          error: "boom",
        }),
      ),
    ).toBe("failed");
  });

  it("marks execution as running when receiving workflow:start", () => {
    expect(syncExecutionStatusFromEvent("pending", buildEvent("workflow:start"))).toBe("running");
  });

  it("keeps failed status when workflow:complete follows a failure", () => {
    expect(syncExecutionStatusFromEvent("failed", buildEvent("workflow:complete"))).toBe("failed");
  });

  it("marks execution as completed when workflow:complete arrives after running", () => {
    expect(syncExecutionStatusFromEvent("running", buildEvent("workflow:complete"))).toBe("completed");
  });

  it("requests detail refresh for terminal status events", () => {
    expect(shouldRefreshExecutionDetail(buildEvent("step:failed"))).toBe(true);
    expect(shouldRefreshExecutionDetail(buildEvent("workflow:complete"))).toBe(true);
    expect(shouldRefreshExecutionDetail(buildEvent("step:progress"))).toBe(false);
  });

  it("returns current status for unrelated events", () => {
    const currentStatus: ExecutionStatus = "running";
    expect(syncExecutionStatusFromEvent(currentStatus, buildEvent("step:progress"))).toBe(currentStatus);
  });
});
