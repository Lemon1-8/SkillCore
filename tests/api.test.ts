import { describe, expect, it } from "vitest";
import { hasModelConnectionApi } from "../src/shared/api";
import type { SkillRepositoryApi } from "../src/shared/api";

describe("skill repository API capability checks", () => {
  it("detects when an older preload has not exposed model connection testing", () => {
    const legacyApi = {} as Partial<SkillRepositoryApi>;
    const currentApi = {
      testModelConnection: async () => ({
        ok: true,
        provider: "deepseek" as const,
        model: "deepseek-chat",
        message: "ok",
        latencyMs: 1,
        checkedAt: "2026-08-22T00:00:00.000Z"
      })
    } as Partial<SkillRepositoryApi>;

    expect(hasModelConnectionApi(legacyApi)).toBe(false);
    expect(hasModelConnectionApi(currentApi)).toBe(true);
  });
});
