import type { SkillListFilters, SkillRecord } from "./types";

function searchableText(skill: SkillRecord): string {
  return [
    skill.name,
    skill.summary,
    skill.category,
    skill.scenario,
    skill.installSteps.join(" "),
    skill.installCommands.join(" "),
    skill.sourceUrl,
    skill.platforms.join(" "),
    skill.notes
  ]
    .join(" ")
    .toLowerCase();
}

function compareDateDesc(field: "createdAt" | "updatedAt") {
  return (a: SkillRecord, b: SkillRecord) => b[field].localeCompare(a[field]);
}

export function filterSortSkills(skills: SkillRecord[], filters: SkillListFilters): SkillRecord[] {
  const query = filters.query.trim().toLowerCase();
  const recentIds = new Set(
    [...skills]
      .sort(compareDateDesc("updatedAt"))
      .slice(0, 5)
      .map((skill) => skill.id)
  );

  const filtered = skills.filter((skill) => {
    const matchesFilter =
      filters.filter === "all" ||
      (filters.filter === "recent" && recentIds.has(skill.id)) ||
      (filters.filter === "uncategorized" && !skill.category) ||
      skill.category === filters.filter;

    return matchesFilter && (!query || searchableText(skill).includes(query));
  });

  return filtered.sort((a, b) => {
    if (filters.sort === "name") {
      return a.name.localeCompare(b.name);
    }

    if (filters.sort === "created") {
      return b.createdAt.localeCompare(a.createdAt);
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function collectCategories(skills: SkillRecord[], defaults: string[] = []): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  defaults.forEach((tag) => counts.set(tag, 0));

  skills.forEach((skill) => {
    if (skill.category) {
      counts.set(skill.category, (counts.get(skill.category) ?? 0) + 1);
    }
  });

  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface CategoryOption {
  name: string;
  count: number;
}

export function suggestCategories(categories: CategoryOption[], query: string): CategoryOption[] {
  const needle = query.trim().toLocaleLowerCase();

  return categories
    .filter((category) => !needle || category.name.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
}

export function isNewCategory(categories: Array<{ name: string }>, value: string): boolean {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const needle = trimmed.toLocaleLowerCase();
  return !categories.some((category) => category.name.toLocaleLowerCase() === needle);
}

export function collectCommonSkills(skills: SkillRecord[]): SkillRecord[] {
  return [...skills]
    .filter((skill) => skill.favorite || skill.viewCount > 0)
    .sort((a, b) => {
      if (a.favorite !== b.favorite) {
        return a.favorite ? -1 : 1;
      }

      if (a.viewCount !== b.viewCount) {
        return b.viewCount - a.viewCount;
      }

      const viewedCompare = b.lastViewedAt.localeCompare(a.lastViewedAt);
      if (viewedCompare !== 0) {
        return viewedCompare;
      }

      return a.name.localeCompare(b.name);
    });
}
