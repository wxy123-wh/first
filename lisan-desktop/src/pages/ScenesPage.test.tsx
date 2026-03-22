import { describe, expect, it } from "vitest";
import { reorderSceneIdsByVisibleOrder } from "./ScenesPage";

describe("reorderSceneIdsByVisibleOrder", () => {
  it("reorders by visible rows and maps back to full order", () => {
    const nextOrder = reorderSceneIdsByVisibleOrder(
      ["scene-1", "scene-2", "scene-3"],
      ["scene-1", "scene-3"],
      "scene-3",
      "up",
    );

    expect(nextOrder).toEqual(["scene-3", "scene-2", "scene-1"]);
  });

  it("returns null when movement goes beyond visible boundaries", () => {
    const nextOrder = reorderSceneIdsByVisibleOrder(
      ["scene-1", "scene-2", "scene-3"],
      ["scene-1", "scene-3"],
      "scene-1",
      "up",
    );

    expect(nextOrder).toBeNull();
  });
});
