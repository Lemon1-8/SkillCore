import { describe, expect, it } from "vitest";
import { isNewCategory, suggestCategories } from "../src/shared/skill-filters";

const categories = [
  { name: "架构图", count: 3 },
  { name: "skill", count: 6 },
  { name: "code", count: 2 },
  { name: "图片、视频、3D", count: 3 }
];

describe("category suggestions", () => {
  it("lists every existing category ordered by usage and then by name", () => {
    expect(suggestCategories(categories, "").map((item) => item.name)).toEqual([
      "skill",
      "架构图",
      "图片、视频、3D",
      "code"
    ]);
  });

  it("matches a query regardless of case and surrounding spaces", () => {
    expect(suggestCategories(categories, " SKI ").map((item) => item.name)).toEqual(["skill"]);
    expect(suggestCategories(categories, "图").map((item) => item.name)).toEqual(["架构图", "图片、视频、3D"]);
  });

  it("returns no suggestion when nothing matches", () => {
    expect(suggestCategories(categories, "不存在")).toEqual([]);
  });

  it("does not reorder the category list it receives", () => {
    const input = [...categories];

    suggestCategories(input, "o");

    expect(input.map((item) => item.name)).toEqual(["架构图", "skill", "code", "图片、视频、3D"]);
  });
});

describe("new category detection", () => {
  it("treats empty input as no category instead of a new one", () => {
    expect(isNewCategory(categories, "")).toBe(false);
    expect(isNewCategory(categories, "   ")).toBe(false);
  });

  it("recognizes an existing name including case differences and padding", () => {
    expect(isNewCategory(categories, "skill")).toBe(false);
    expect(isNewCategory(categories, " Skill ")).toBe(false);
    expect(isNewCategory(categories, "架构图")).toBe(false);
  });

  it("accepts a name that is not used yet", () => {
    expect(isNewCategory(categories, "自动化")).toBe(true);
  });
});
