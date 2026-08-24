import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Declarations = Record<string, string>;

function declarationsFromBlock(block: string): Declarations {
  return Object.fromEntries(
    block
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separatorIndex = declaration.indexOf(":");
        return [
          declaration.slice(0, separatorIndex).trim(),
          declaration.slice(separatorIndex + 1).trim()
        ];
      })
  );
}

function stripNestedAtRules(css: string): string {
  let result = css;
  let atRuleStart = result.search(/@(media|keyframes)\b/);

  while (atRuleStart >= 0) {
    const blockStart = result.indexOf("{", atRuleStart);
    if (blockStart < 0) {
      break;
    }

    let depth = 0;
    let blockEnd = blockStart;
    for (; blockEnd < result.length; blockEnd += 1) {
      const char = result[blockEnd];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          blockEnd += 1;
          break;
        }
      }
    }

    result = `${result.slice(0, atRuleStart)}${result.slice(blockEnd)}`;
    atRuleStart = result.search(/@(media|keyframes)\b/);
  }

  return result;
}

function finalDeclaration(css: string, selector: string, property: string): string | undefined {
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let declaration: string | undefined;

  for (const rule of stripNestedAtRules(css).matchAll(rulePattern)) {
    const selectors = rule[1].split(",").map((item) => item.trim());

    if (selectors.includes(selector)) {
      declaration = declarationsFromBlock(rule[2])[property] ?? declaration;
    }
  }

  return declaration;
}

describe("detail sidebar layout", () => {
  const css = readFileSync(path.resolve("src/renderer/styles.css"), "utf8");

  it("keeps the common Skill navigation visible in detail mode", () => {
    expect(finalDeclaration(css, ".app-shell.detail-active", "grid-template-columns")).toMatch(/^220px\b/);
    expect(finalDeclaration(css, ".app-shell.detail-active.list-pane-collapsed", "grid-template-columns")).toMatch(/^220px\b/);
    expect(finalDeclaration(css, ".app-shell.detail-active .common-skill-section", "display")).not.toBe("none");
    expect(finalDeclaration(css, ".app-shell.detail-active .common-skill-item", "display")).not.toBe("none");
    expect(finalDeclaration(css, ".app-shell.detail-active .section-title", "display")).not.toBe("none");
  });

  it("keeps detail view filters aligned like full sidebar rows", () => {
    expect(finalDeclaration(css, ".nav-item", "justify-content")).toBe("space-between");
    expect(finalDeclaration(css, ".app-shell.detail-active .nav-item", "justify-content")).not.toBe("center");
    expect(finalDeclaration(css, ".app-shell.detail-active .nav-item", "padding")).not.toBe("0");
  });
});
