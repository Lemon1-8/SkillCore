import type { SkillListFilters } from "../shared/types";

export const homeFilters: SkillListFilters = { query: "", filter: "all", sort: "updated" };

export interface HomeNavigationState {
  activeId: undefined;
  filters: SkillListFilters;
  listToolsCollapsed: boolean;
  mode: "browse";
}

export function createHomeNavigationState(): HomeNavigationState {
  return {
    activeId: undefined,
    filters: { ...homeFilters },
    listToolsCollapsed: false,
    mode: "browse"
  };
}
