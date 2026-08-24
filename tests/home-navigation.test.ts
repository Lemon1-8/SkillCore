import { describe, expect, it } from "vitest";
import { createHomeNavigationState, homeFilters } from "../src/renderer/home-navigation";

describe("home navigation", () => {
  it("returns to card browsing with all skills selected", () => {
    expect(createHomeNavigationState()).toEqual({
      activeId: undefined,
      filters: { query: "", filter: "all", sort: "updated" },
      listToolsCollapsed: false,
      mode: "browse"
    });
  });

  it("returns a fresh filters object", () => {
    const first = createHomeNavigationState();
    const second = createHomeNavigationState();

    expect(first.filters).toEqual(homeFilters);
    expect(first.filters).not.toBe(second.filters);
  });
});
