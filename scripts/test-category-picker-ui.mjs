import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";

const require = createRequire(import.meta.url);
const temporary = await mkdtemp(path.join(tmpdir(), "skill-category-ui-"));
const userData = path.join(temporary, "user-data");
await mkdir(userData);
let application;

async function shot(page, name) {
  const directory = process.env.SKILL_REPO_SHOT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name) });
}

const skills = [
  ["MarkItDown 文件转 Markdown", "把办公文档转换为 Markdown。", "skill"],
  ["Diagram Design", "从一句话生成图表 HTML。", "skill"],
  ["Craft Anything", "开源的逆向与分析工具箱。", "架构图"],
  ["REA (rea-agents)", "逆向工程的 MCP 工具。", "逆向"],
  ["未分类条目", "还没有归类的 Skill。", ""]
];

try {
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [path.resolve("scripts/archive-electron-test-entry.cjs")],
    env: { ...process.env, SKILL_REPO_TEST_USER_DATA: userData, SKILL_REPO_SMOKE: "0", VITE_DEV_SERVER_URL: "" }
  });
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1360, height: 860 });
  await page.getByRole("button", { name: "AI 导入", exact: true }).waitFor();

  await page.evaluate(async (seed) => {
    for (const [name, summary, category] of seed) {
      await window.skillRepo.createSkill({
        name,
        summary,
        category,
        tags: [],
        scenario: "",
        installSteps: [],
        installCommands: [],
        sourceUrl: "",
        platforms: ["Windows"],
        notes: ""
      });
    }
  }, skills);
  await page.reload();
  await page.getByRole("button", { name: "AI 导入", exact: true }).waitFor();

  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Diagram Design", exact: true }) }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const category = page.getByRole("combobox", { name: "分类", exact: true });
  const listbox = page.getByRole("listbox", { name: "已有分类" });
  await category.waitFor();
  assert.equal(await category.getAttribute("aria-expanded"), "false");
  assert.equal(await category.inputValue(), "skill");

  // Opening the picker lists every existing category, not only the current value.
  await category.click();
  await listbox.waitFor();
  assert.equal(await listbox.getByRole("option").count(), 3);
  assert.equal(await listbox.getByRole("option", { name: /skill/ }).getAttribute("aria-selected"), "true");
  await shot(page, "category-menu-open.png");

  // Typing keeps working and offers to create the new name.
  await category.fill("架构");
  assert.equal(await listbox.getByRole("option").count(), 2);
  const createRow = listbox.getByRole("option").first();
  assert.match(await createRow.innerText(), /新建分类「架构」/);
  await shot(page, "category-new-offer.png");
  await category.press("ArrowDown");
  await category.press("Enter");
  assert.equal(await category.inputValue(), "架构");
  assert.equal(await category.getAttribute("aria-expanded"), "false");

  // Existing names can be picked with the mouse, and the current one is marked.
  await category.click();
  await listbox.getByRole("option").filter({ hasText: "逆向" }).click();
  assert.equal(await category.inputValue(), "逆向");
  await category.click();
  assert.equal(await listbox.getByRole("option", { name: /逆向/ }).getAttribute("aria-selected"), "true");
  await category.press("Escape");
  assert.equal(await category.getAttribute("aria-expanded"), "false");

  // The picked category is stored, and a typed name becomes a new category.
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("Skill 已保存", { exact: true }).waitFor();
  let stored = await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }));
  assert.equal(stored.find((item) => item.name === "Diagram Design").category, "逆向");

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await category.fill("自动化测试");
  await category.press("Enter");
  assert.equal(await category.getAttribute("aria-expanded"), "false");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("Skill 已保存", { exact: true }).waitFor();
  stored = await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }));
  assert.equal(stored.find((item) => item.name === "Diagram Design").category, "自动化测试");

  // The new name becomes a suggestion for the other entries.
  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Craft Anything", exact: true }) }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await category.click();
  const options = await page.getByRole("listbox", { name: "已有分类" }).getByRole("option").allInnerTexts();
  assert.ok(options.some((text) => text.includes("自动化测试")), `missing new category in ${JSON.stringify(options)}`);
  assert.ok(options.some((text) => text.includes("架构图")), `missing existing category in ${JSON.stringify(options)}`);

  console.log("category-picker-ui:passed", JSON.stringify(options));
} finally {
  if (application) await application.close();
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
