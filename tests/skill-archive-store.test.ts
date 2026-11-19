import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillStore, type SkillStore } from "../src/main/skill-store";
import { makeZip, validSkill } from "./helpers/zip";

let directory: string;
let store: SkillStore;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "skill-zip-store-"));
  store = createSkillStore(path.join(directory, "skills.sqlite"));
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("Skill archive persistence", () => {
  const archive = makeZip([
    { name: "pdf-tools/SKILL.md", content: validSkill },
    { name: "pdf-tools/scripts/extract.py", content: "print('example')" }
  ]);

  it("atomically saves the Skill and original ZIP and persists them after reopening", async () => {
    const record = await store.importSkillArchive(archive, "download.zip");
    store.close();
    store = createSkillStore(path.join(directory, "skills.sqlite"));
    expect(store.get(record.id)).toMatchObject({ name: "pdf-tools", archiveName: "download.zip" });
    expect(store.get(record.id)?.notes).toBe("\n# PDF Tools\n\nRead references/guide.md and run scripts/extract.py.\n");
    expect(store.getArchive(record.id)).toEqual({ fileName: "download.zip", data: archive });
    expect(store.list({ query: "", filter: "all", sort: "updated" })).toHaveLength(1);
  });

  it("rejects duplicate names and preserves the original record and ZIP", async () => {
    const record = await store.importSkillArchive(archive, "original.zip");
    const changed = makeZip([{ name: "SKILL.md", content: validSkill.replace("Extract PDF text.", "Changed.") }]);
    await expect(store.importSkillArchive(changed, "new.zip")).rejects.toThrow("已存在");
    expect(store.getArchive(record.id)).toEqual({ fileName: "original.zip", data: archive });
    expect(store.get(record.id)?.summary).toBe("Extract PDF text. Use when processing PDFs.");
    expect(store.list({ query: "", filter: "all", sort: "updated" })).toHaveLength(1);
  });

  it("invalid ZIP does not create records or archive attachments", async () => {
    await expect(store.importSkillArchive(Buffer.from("broken"), "broken.zip")).rejects.toThrow("ZIP");
    expect(store.list({ query: "", filter: "all", sort: "updated" })).toHaveLength(0);
  });

  it("deletes the stored ZIP with its Skill", async () => {
    const record = await store.importSkillArchive(archive, "download.zip");
    expect(store.remove(record.id)).toBe(true);
    expect(store.get(record.id)).toBeUndefined();
    expect(store.getArchive(record.id)).toBeUndefined();
  });

  it("editing a Skill preserves its original archive", async () => {
    const record = await store.importSkillArchive(archive, "download.zip");
    const updated = store.update(record.id, { category: "文档" });
    expect(updated.archiveName).toBe("download.zip");
    expect(store.getArchive(record.id)?.data).toEqual(archive);
  });

  it("rolls back the Skill if writing the original archive fails", async () => {
    const database = new Database(path.join(directory, "skills.sqlite"));
    try {
      database.exec("CREATE TRIGGER reject_archive BEFORE INSERT ON skill_archives BEGIN SELECT RAISE(ABORT, 'archive write failed'); END;");
      await expect(store.importSkillArchive(archive, "download.zip")).rejects.toThrow("archive write failed");
      expect(store.list({ query: "", filter: "all", sort: "updated" })).toHaveLength(0);
      expect(database.prepare("SELECT COUNT(*) AS count FROM skill_archives").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("serializes simultaneous imports of the same name without overwriting", async () => {
    const results = await Promise.allSettled([
      store.importSkillArchive(archive, "first.zip"),
      store.importSkillArchive(archive, "second.zip")
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.list({ query: "", filter: "all", sort: "updated" })).toHaveLength(1);
  });
});
