import { describe, expect, it } from "vitest";
import { createUnifiedDiff } from "../diff.js";

describe("createUnifiedDiff", () => {
  it("returns null for identical content", () => {
    expect(createUnifiedDiff("same\n", "same\n")).toBeNull();
  });

  it("returns a unified diff for changes", () => {
    const diff = createUnifiedDiff("before\n", "after\n");
    expect(diff).not.toBeNull();
    if (!diff) {
      return;
    }
    expect(diff).toContain("-before");
    expect(diff).toContain("+after");
  });
});
