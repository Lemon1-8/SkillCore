import { fromBufferPromise, type ZipFile } from "yauzl";
import { parseDocument } from "yaml";
import { buf as crc32 } from "crc-32";
import type { SkillInput } from "../shared/types";

export const maxArchiveBytes = 20 * 1024 * 1024;
const maxExpandedBytes = 100 * 1024 * 1024;
const maxSkillMdBytes = 1024 * 1024;
const maxEntries = 2000;

class SkillArchiveError extends Error {}

function invalid(message: string): never {
  throw new SkillArchiveError(message);
}

function ignoredPath(name: string): boolean {
  return name.startsWith("__MACOSX/") || name.split("/").at(-1) === ".DS_Store";
}

function parseSkillMarkdown(content: string, filePath: string): SkillInput {
  const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!frontmatter) {
    invalid("SKILL.md 必须以 YAML 元数据开头，并使用 --- 分隔。");
  }
  let fields: unknown;
  try {
    const document = parseDocument(frontmatter[1]);
    if (document.errors.length) {
      invalid(`SKILL.md 的 YAML 格式错误：${document.errors[0].message}`);
    }
    fields = document.toJS({ mapAsMap: true, maxAliasCount: 50 });
  } catch (error) {
    if (error instanceof SkillArchiveError) throw error;
    invalid("SKILL.md 的 YAML 无法解析，请检查元数据结构。");
  }
  if (!(fields instanceof Map)) {
    invalid("SKILL.md 的 YAML 元数据必须是字段映射。");
  }

  const errors: string[] = [];
  for (const key of fields.keys()) {
    if (typeof key !== "string") {
      errors.push("YAML 元数据字段名必须为字符串。");
    }
  }
  const rawName = fields.get("name");
  const name = typeof rawName === "string" ? rawName.trim().normalize("NFKC") : "";
  if (!name) {
    errors.push("缺少有效的 name：必须为非空字符串。");
  } else {
    if ([...name].length > 64) errors.push("name 最多 64 个字符。");
    if (name !== name.toLowerCase()) errors.push("name 中的字母必须为小写。");
    if (!/^[\p{L}\p{N}-]+$/u.test(name)) errors.push("name 只能包含字母、数字和连字符。");
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      errors.push("name 不能以连字符开头或结尾，也不能有连续连字符。");
    }
    const directory = filePath.split("/").at(-2);
    if (directory && directory.normalize("NFKC") !== name) {
      errors.push(`目录名「${directory}」与 name「${name}」不一致。`);
    }
  }
  const description = fields.get("description");
  if (typeof description !== "string" || !description.trim()) {
    errors.push("缺少有效的 description：必须为非空字符串。");
  } else if ([...description].length > 1024) {
    errors.push("description 最多 1024 个字符。");
  }
  // Skills are catalogued, not executed. Preserve vendor extension fields in the
  // original ZIP instead of rejecting a valid skill for additional metadata.
  for (const key of ["license", "compatibility", "argument-hint"]) {
    if (fields.has(key) && typeof fields.get(key) !== "string") {
      errors.push(`${key} 必须为字符串。`);
    }
  }
  const allowedTools = fields.get("allowed-tools");
  if (fields.has("allowed-tools") && typeof allowedTools !== "string" &&
      !(Array.isArray(allowedTools) && allowedTools.every((tool) => typeof tool === "string"))) {
    errors.push("allowed-tools 必须为字符串或字符串列表。");
  }
  const compatibility = fields.get("compatibility");
  if (typeof compatibility === "string" && (!compatibility.trim() || [...compatibility].length > 500)) {
    errors.push("compatibility 必须为 1–500 个字符。");
  }
  if (fields.has("metadata")) {
    const metadata = fields.get("metadata");
    if (!(metadata instanceof Map) || [...metadata].some(([key, value]) => typeof key !== "string" || typeof value !== "string")) {
      errors.push("metadata 必须为字符串键和字符串值的映射。");
    }
  }
  if (errors.length) invalid(`Skill 格式不符合标准：\n${errors.join("\n")}`);

  return {
    name,
    summary: (description as string).trim(),
    category: "",
    tags: [],
    scenario: "",
    installSteps: [],
    installCommands: [],
    sourceUrl: "",
    platforms: [],
    notes: content.slice(frontmatter[0].length)
  };
}

export async function parseSkillArchive(archive: Buffer): Promise<SkillInput> {
  if (archive.length > maxArchiveBytes) invalid("ZIP 文件不能超过 20 MB。");
  let zip: ZipFile | undefined;
  try {
    zip = await fromBufferPromise(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
    if (zip.entryCount > maxEntries) invalid("ZIP 最多允许 2000 个文件或目录。");
    const paths = new Set<string>();
    const files: string[] = [];
    const skills: Array<{ path: string; content: string }> = [];
    let declaredBytes = 0;
    let expandedBytes = 0;
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName;
      const parts = name.replace(/\/$/, "").split("/");
      if (parts.some((part) => !part || part === "." || part === ".." || /[:\x00\\]/.test(part))) {
        invalid(`ZIP 包含不安全的路径：${name}`);
      }
      const pathKey = name.normalize("NFKC").toLowerCase();
      if (paths.has(pathKey)) invalid(`ZIP 包含重复路径：${name}`);
      paths.add(pathKey);
      if (entry.isEncrypted()) invalid(`不支持加密 ZIP 文件：${name}`);
      if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
        invalid(`ZIP 不允许包含符号链接：${name}`);
      }
      declaredBytes += entry.uncompressedSize;
      if (declaredBytes > maxExpandedBytes) invalid("ZIP 解压后总大小不能超过 100 MB。");
      if (name.endsWith("/")) continue;
      const isSkillMd = !ignoredPath(name) && parts.at(-1) === "SKILL.md";
      if (isSkillMd && entry.uncompressedSize > maxSkillMdBytes) invalid("SKILL.md 不能超过 1 MB。");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let checksum = 0;
      let entryBytes = 0;
      for await (const data of stream) {
        const chunk = data as Buffer;
        expandedBytes += chunk.length;
        entryBytes += chunk.length;
        if (expandedBytes > maxExpandedBytes || (isSkillMd && entryBytes > maxSkillMdBytes)) {
          stream.destroy();
          invalid("ZIP 解压内容超过应用限制（总大小 100 MB，SKILL.md 1 MB）。");
        }
        checksum = crc32(chunk, checksum);
        if (isSkillMd) chunks.push(chunk);
      }
      if ((checksum >>> 0) !== entry.crc32) invalid(`ZIP 文件损坏，校验失败：${name}`);
      if (ignoredPath(name)) continue;
      files.push(name);
      if (isSkillMd) {
        let content: string;
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        } catch {
          invalid("SKILL.md 必须使用有效的 UTF-8 编码。");
        }
        skills.push({ path: name, content });
      }
    }
    if (!skills.length) invalid("ZIP 中缺少 SKILL.md，请使用准确的文件名和大小写。");
    if (skills.length > 1) invalid("ZIP 中包含多个 Skill，请拆分后分别导入。");
    const skill = skills[0];
    const parts = skill.path.split("/");
    if (parts.length > 2) invalid("SKILL.md 必须位于 ZIP 根目录或第一层 Skill 目录中。");
    if (parts.length === 2 && files.some((name) => !name.startsWith(`${parts[0]}/`))) {
      invalid("ZIP 包含 Skill 目录之外的文件，请只压缩单个 Skill 目录。");
    }
    return parseSkillMarkdown(skill.content, skill.path);
  } catch (error) {
    if (error instanceof SkillArchiveError) throw error;
    const reason = error instanceof Error ? error.message : "未知错误";
    if (/path|backslash|fileName/i.test(reason)) invalid("ZIP 包含不安全的路径，请检查绝对路径、反斜杠或 ..。");
    return invalid(`无法解析 ZIP，文件可能损坏或压缩格式不受支持：${reason}`);
  } finally {
    zip?.close();
  }
}
