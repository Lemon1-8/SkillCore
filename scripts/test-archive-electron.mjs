import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron } from "playwright-core";
import CRC32 from "crc-32";

const require = createRequire(import.meta.url);
const temporary = await mkdtemp(path.join(tmpdir(), "skill-archive-ui-"));
const userData = path.join(temporary, "user-data");
await mkdir(userData);
let application;

// Real ZIP fixture, built without external tools or network calls.
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [fileName, text] of entries) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(text);
    const crc = CRC32.str(text) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46);
    index.writeUInt32LE(0x02014b50, 0);
    index.writeUInt16LE(20, 4);
    index.writeUInt16LE(20, 6);
    index.writeUInt16LE(0x800, 8);
    index.writeUInt32LE(crc, 16);
    index.writeUInt32LE(data.length, 20);
    index.writeUInt32LE(data.length, 24);
    index.writeUInt16LE(name.length, 28);
    index.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(index, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function launch() {
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [path.resolve("scripts/archive-electron-test-entry.cjs")],
    env: { ...process.env, SKILL_REPO_TEST_USER_DATA: userData, SKILL_REPO_SMOKE: "0", VITE_DEV_SERVER_URL: "" }
  });
  const page = await application.firstWindow();
  await page.getByRole("button", { name: "AI 导入", exact: true }).waitFor();
  return page;
}

async function chooseArchive(filePath) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: !selectedPath, filePaths: selectedPath ? [selectedPath] : [] });
  }, filePath);
}

try {
  const markdown = "---\nname: ui-example\ndescription: Test importing a Skill archive.\n---\n\n# UI Example\n\nOriginal instructions.\n";
  const original = zip([["ui-example/SKILL.md", markdown], ["ui-example/assets/example.txt", "Attachment preserved."]]);
  const validPath = path.join(temporary, "valid.zip");
  const missingPath = path.join(temporary, "missing.zip");
  const multiplePath = path.join(temporary, "multiple.zip");
  await writeFile(validPath, original);
  await writeFile(missingPath, zip([["SKILL.md", "---\nname: missing-description\n---\nInstructions"]]));
  await writeFile(multiplePath, zip([["ui-example/SKILL.md", markdown], ["other/SKILL.md", markdown.replace("ui-example", "other")]]));
  let page = await launch();
  assert.equal(await page.getByRole("button", { name: "手动新建 Skill", exact: true }).count(), 0);
  await chooseArchive(missingPath);
  await page.getByRole("button", { name: "导入 Skill ZIP", exact: true }).first().click();
  const error = page.getByRole("alert");
  await error.waitFor();
  assert.match(await error.innerText(), /description/);
  // A toast would have disappeared; format errors must still be readable.
  await page.waitForTimeout(2000);
  assert.equal(await error.isVisible(), true);
  assert.equal((await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }))).length, 0);

  await chooseArchive(multiplePath);
  await page.getByRole("button", { name: "选择 ZIP 文件", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "多个 Skill" }).waitFor();
  await chooseArchive(undefined);
  await page.getByRole("button", { name: "选择 ZIP 文件", exact: true }).click();
  await page.getByRole("button", { name: "选择 ZIP 文件", exact: true }).waitFor({ state: "visible" });
  assert.equal(await error.count(), 0);

  await chooseArchive(validPath);
  await page.getByRole("button", { name: "选择 ZIP 文件", exact: true }).click();
  await page.getByRole("heading", { name: "ui-example", exact: true, level: 2 }).waitFor();
  const records = await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }));
  assert.equal(records.length, 1);
  assert.equal(records[0].notes, "\n# UI Example\n\nOriginal instructions.\n");
  assert.equal(records[0].archiveName, "valid.zip");
  const exportPath = path.join(temporary, "exported.zip");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole("button", { name: /导出原始 ZIP/ }).click();
  await page.getByText("原始 ZIP 已导出", { exact: true }).waitFor();
  assert.deepEqual(await readFile(exportPath), original);

  await chooseArchive(validPath);
  await page.getByRole("button", { name: "导入 Skill ZIP", exact: true }).first().click();
  await page.getByRole("alert").filter({ hasText: "已存在" }).waitFor();
  assert.equal((await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }))).length, 1);
  await application.close();
  application = undefined;
  page = await launch();
  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: "ui-example", exact: true }) }).click();
  await page.getByRole("button", { name: /导出原始 ZIP/ }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByText("Skill 已删除", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }))).length, 0);

  // Regression: import the user's unchanged package through the real IPC and UI.
  const handoffPath = path.resolve("tests/fixtures/mattpocock-skills-handoff-1.0.1.zip");
  await chooseArchive(handoffPath);
  await page.getByRole("button", { name: "导入 Skill ZIP", exact: true }).first().click();
  await page.getByRole("heading", { name: "handoff", exact: true, level: 2 }).waitFor();
  const handoffRecords = await page.evaluate(() => window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" }));
  assert.equal(handoffRecords.length, 1);
  assert.equal(handoffRecords[0].name, "handoff");
  assert.equal(handoffRecords[0].summary, "Compact the current conversation into a handoff document for another agent to pick up.");
  const handoffExport = path.join(temporary, "handoff-export.zip");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, handoffExport);
  await page.getByRole("button", { name: /导出原始 ZIP/ }).click();
  await page.getByText("原始 ZIP 已导出", { exact: true }).waitFor();
  assert.deepEqual(await readFile(handoffExport), await readFile(handoffPath));
  console.log("skill-archive-ui:passed (validation, cancellation, import, duplicate, export, restart, deletion, real handoff package)");
} finally {
  if (application) await application.close();
  assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true });
}
