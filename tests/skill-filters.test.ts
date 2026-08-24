import { describe, expect, it } from "vitest";
import { collectCategories, collectCommonSkills, filterSortSkills } from "../src/shared/skill-filters";
import type { SkillRecord } from "../src/shared/types";

const records: SkillRecord[] = [
  {
    id: "a",
    name: "frontend-design",
    summary: "创建高质量前端界面",
    category: "设计",
    tags: ["前端", "UI"],
    scenario: "Web UI 原型",
    installSteps: ["安装"],
    installCommands: ["codex skill install frontend-design"],
    sourceUrl: "https://example.com/frontend",
    platforms: ["Windows", "Codex"],
    notes: "",
    viewCount: 2,
    lastViewedAt: "2026-08-22T08:00:00.000Z",
    favorite: false,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z"
  },
  {
    id: "b",
    name: "lark-doc",
    summary: "读取和编辑飞书文档",
    category: "文档",
    tags: ["飞书", "文档处理"],
    scenario: "文档自动化",
    installSteps: ["登录", "读取"],
    installCommands: ["lark-cli doc read --url <url>"],
    sourceUrl: "https://example.com/lark",
    platforms: ["Windows"],
    notes: "",
    viewCount: 1,
    lastViewedAt: "2026-08-22T09:00:00.000Z",
    favorite: true,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z"
  },
  {
    id: "c",
    name: "untagged",
    summary: "未分类条目",
    category: "",
    tags: [],
    scenario: "临时保存",
    installSteps: [],
    installCommands: [],
    sourceUrl: "",
    platforms: ["Windows"],
    notes: "",
    viewCount: 0,
    lastViewedAt: "",
    favorite: false,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z"
  }
];

describe("skill list filtering", () => {
  it("searches across name, summary, category, scenario, and install commands", () => {
    const result = filterSortSkills(records, {
      query: "doc read",
      filter: "all",
      sort: "updated"
    });

    expect(result.map((item) => item.id)).toEqual(["b"]);
  });

  it("filters by user category and uncategorized view without treating tags as categories", () => {
    expect(
      filterSortSkills(records, { query: "", filter: "设计", sort: "updated" }).map((item) => item.id)
    ).toEqual(["a"]);

    expect(
      filterSortSkills(records, { query: "", filter: "前端", sort: "updated" }).map((item) => item.id)
    ).toEqual([]);

    expect(
      filterSortSkills(records, { query: "", filter: "uncategorized", sort: "updated" }).map((item) => item.id)
    ).toEqual(["c"]);
  });

  it("sorts by name and creation time", () => {
    expect(
      filterSortSkills(records, { query: "", filter: "all", sort: "name" }).map((item) => item.id)
    ).toEqual(["a", "b", "c"]);

    expect(
      filterSortSkills(records, { query: "", filter: "all", sort: "created" }).map((item) => item.id)
    ).toEqual(["a", "c", "b"]);
  });

  it("collects only user-created categories", () => {
    expect(collectCategories([], ["飞书", "前端"])).toEqual([]);

    const result = collectCategories(records, ["飞书", "不存在"]);

    expect(result).toEqual([
      { name: "设计", count: 1 },
      { name: "文档", count: 1 }
    ]);
    expect(result).not.toContainEqual({ name: "不存在", count: 0 });
  });

  it("collects common skills by favorite first and then view frequency", () => {
    const result = collectCommonSkills(records);

    expect(result.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
