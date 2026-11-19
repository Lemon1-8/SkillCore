import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkillArchive } from "../src/main/skill-archive";
import { makeZip, validSkill } from "./helpers/zip";

describe("Skill ZIP parsing", () => {
  it.each(["SKILL.md", "pdf-tools/SKILL.md"])("imports %s and preserves the Markdown body", async (name) => {
    const parsed = await parseSkillArchive(makeZip([
      { name, content: validSkill, compressed: true },
      { name: name.replace("SKILL.md", "references/guide.md"), content: "A reference" }
    ]));
    expect(parsed).toMatchObject({
      name: "pdf-tools",
      summary: "Extract PDF text. Use when processing PDFs.",
      notes: "\n# PDF Tools\n\nRead references/guide.md and run scripts/extract.py.\n"
    });
  });

  it("accepts Unicode names following the official reference validator", async () => {
    const result = await parseSkillArchive(makeZip([{ name: "文档工具/SKILL.md", content: validSkill.replace("pdf-tools", "文档工具") }]));
    expect(result.name).toBe("文档工具");
  });

  it("supports CRLF, BOM, multiline YAML and optional metadata", async () => {
    const content = "\uFEFF---\r\nname: pdf-tools\r\ndescription: >-\r\n  Read PDF files.\r\n  Use for PDFs.\r\nlicense: MIT\r\ncompatibility: Requires Python\r\nmetadata:\r\n  author: example\r\nallowed-tools: Read Bash(python:*)\r\n---\r\n# Instructions\r\n";
    const result = await parseSkillArchive(makeZip([{ name: "SKILL.md", content }]));
    expect(result.summary).toBe("Read PDF files. Use for PDFs.");
    expect(result.notes).toBe("# Instructions\r\n");
  });

  it("imports the real handoff package with Claude Code argument-hint", async () => {
    const archive = readFileSync(path.resolve("tests/fixtures/mattpocock-skills-handoff-1.0.1.zip"));
    const result = await parseSkillArchive(archive);
    expect(result.name).toBe("handoff");
    expect(result.summary).toBe("Compact the current conversation into a handoff document for another agent to pick up.");
    expect(result.notes).toContain("Write a handoff document summarising the current conversation");
  });

  it("accepts extension fields without requiring them to be moved into metadata", async () => {
    const content = validSkill.replace("---\n\n#", 'argument-hint: "[filename]"\ndisable-model-invocation: true\nuser-invocable: false\ncontext: fork\nagent: Explore\nversion: 1\ncustom-extension:\n  flag: true\n---\n\n#');
    expect((await parseSkillArchive(makeZip([{ name: "SKILL.md", content }]))).name).toBe("pdf-tools");
  });

  it("accepts Claude Code allowed-tools YAML string lists", async () => {
    const content = validSkill.replace("---\n\n#", "allowed-tools: [Read, 'Bash(python:*)']\n---\n\n#");
    expect((await parseSkillArchive(makeZip([{ name: "SKILL.md", content }]))).name).toBe("pdf-tools");
  });

  it.each([
    ["README.md", validSkill, "SKILL.md"],
    ["skill.md", validSkill, "SKILL.md"],
    ["other/SKILL.md", validSkill, "目录名"],
    ["repo/pdf-tools/SKILL.md", validSkill, "根目录"],
    ["SKILL.md", "# Instructions", "YAML"],
    ["SKILL.md", "---\nname: [\n---\n", "YAML"],
    ["SKILL.md", validSkill.replace("name: pdf-tools\n", ""), "name"],
    ["SKILL.md", validSkill.replace(/description:.*\n/, ""), "description"],
    ["SKILL.md", validSkill.replace("pdf-tools", "PDF-tools"), "小写"],
    ["SKILL.md", validSkill.replace("pdf-tools", "pdf--tools"), "连字符"],
    ["SKILL.md", validSkill.replace("pdf-tools", "x".repeat(65)), "64"],
    ["SKILL.md", validSkill.replace(/description:.*\n/, "description: 123\n"), "description"],
    ["SKILL.md", validSkill.replace(/description:.*\n/, 'description: "   "\n'), "description"],
    ["SKILL.md", validSkill.replace(/description:.*\n/, `description: ${"x".repeat(1025)}\n`), "1024"],
    ["SKILL.md", validSkill.replace("---\n\n#", "metadata:\n  version: 1\n---\n\n#"), "metadata"],
    ["SKILL.md", validSkill.replace("---\n\n#", "license: 1\n---\n\n#"), "license"],
    ["SKILL.md", validSkill.replace("---\n\n#", "allowed-tools: [123]\n---\n\n#"), "allowed-tools"],
    ["SKILL.md", validSkill.replace("---\n\n#", "argument-hint: 123\n---\n\n#"), "argument-hint"],
    ["SKILL.md", validSkill.replace("---\n\n#", `compatibility: ${"x".repeat(501)}\n---\n\n#`), "compatibility"]
  ])("rejects invalid skill %s (%s)", async (name, content, error) => {
    await expect(parseSkillArchive(makeZip([{ name, content }]))).rejects.toThrow(error);
  });

  it("reports multiple field errors together", async () => {
    await expect(parseSkillArchive(makeZip([{ name: "SKILL.md", content: "---\nlicense: MIT\n---\n" }]))).rejects.toThrow(/name[\s\S]*description/);
  });

  it("does not reject an empty body or long instructions as a format violation", async () => {
    for (const body of ["", "Instructions\n".repeat(501)]) {
      const content = `---\nname: pdf-tools\ndescription: Read PDFs.\n---\n${body}`;
      expect((await parseSkillArchive(makeZip([{ name: "SKILL.md", content }]))).notes).toBe(body);
    }
  });

  it("rejects multiple skills rather than importing one arbitrarily", async () => {
    await expect(parseSkillArchive(makeZip([
      { name: "pdf-tools/SKILL.md", content: validSkill },
      { name: "other/SKILL.md", content: validSkill.replace("pdf-tools", "other") }
    ]))).rejects.toThrow("多个 Skill");
  });

  it("ignores macOS archive metadata", async () => {
    expect((await parseSkillArchive(makeZip([
      { name: "pdf-tools/SKILL.md", content: validSkill },
      { name: "__MACOSX/pdf-tools/._SKILL.md", content: "metadata" },
      { name: ".DS_Store", content: "metadata" }
    ]))).name).toBe("pdf-tools");
  });

  it.each(["../escape.txt", "/absolute.txt", "C:/escape.txt", "pdf-tools/../escape.txt", "pdf-tools\\..\\escape.txt"])("rejects unsafe ZIP path %s", async (name) => {
    await expect(parseSkillArchive(makeZip([
      { name: "SKILL.md", content: validSkill }, { name, content: "unsafe" }
    ]))).rejects.toThrow(/路径/);
  });

  it("rejects symbolic links and encrypted files", async () => {
    for (const attributes of [{ attributes: (0o120777 << 16) >>> 0 }, { encrypted: true }]) {
      await expect(parseSkillArchive(makeZip([{ name: "SKILL.md", content: validSkill, ...attributes }]))).rejects.toThrow(/符号链接|加密/);
    }
  });

  it("rejects duplicate ZIP entry paths", async () => {
    await expect(parseSkillArchive(makeZip([
      { name: "SKILL.md", content: validSkill }, { name: "SKILL.md", content: validSkill }
    ]))).rejects.toThrow("重复路径");
  });

  it("rejects malformed ZIP, invalid UTF-8 and CRC corruption, including attachments", async () => {
    await expect(parseSkillArchive(Buffer.from("not a zip"))).rejects.toThrow("ZIP");
    await expect(parseSkillArchive(makeZip([{ name: "SKILL.md", content: Buffer.from([0xff]) }]))).rejects.toThrow("UTF-8");
    await expect(parseSkillArchive(makeZip([
      { name: "SKILL.md", content: validSkill }, { name: "assets/example.txt", content: "test", corruptCrc: true }
    ]))).rejects.toThrow(/损坏|校验/);
  });

  it("rejects archives over application size limits before buffering contents", async () => {
    await expect(parseSkillArchive(Buffer.alloc(20 * 1024 * 1024 + 1))).rejects.toThrow("20 MB");
    await expect(parseSkillArchive(makeZip([{ name: "SKILL.md", content: "x".repeat(1024 * 1024 + 1), compressed: true }]))).rejects.toThrow("1 MB");
    await expect(parseSkillArchive(makeZip([{ name: "SKILL.md", content: validSkill, compressed: true, declaredSize: 101 * 1024 * 1024 }]))).rejects.toThrow("100 MB");
    await expect(parseSkillArchive(makeZip(Array.from({ length: 2001 }, (_, index) => ({ name: `file-${index}.txt`, content: "" }))))).rejects.toThrow("2000");
  });
});
