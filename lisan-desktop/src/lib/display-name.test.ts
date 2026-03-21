import { describe, expect, it } from "vitest";
import { resolveDisplayName } from "./display-name";

describe("display-name util", () => {
  it("returns mapped name when id can be resolved", () => {
    const label = resolveDisplayName({
      id: "workflow-1",
      nameById: {
        "workflow-1": "主线工作流",
      },
      missingLabel: "已删除工作流",
      emptyLabel: "无",
    });

    expect(label).toBe("主线工作流");
  });

  it("returns readable deleted label with id suffix when mapping is missing", () => {
    const label = resolveDisplayName({
      id: "workflow-123456789",
      nameById: {},
      missingLabel: "已删除工作流",
      emptyLabel: "无",
    });

    expect(label).toBe("已删除工作流（ID后6位：456789）");
  });

  it("returns empty label when id is missing", () => {
    const label = resolveDisplayName({
      id: "",
      nameById: {},
      missingLabel: "已删除工作流",
      emptyLabel: "无",
    });

    expect(label).toBe("无");
  });
});
