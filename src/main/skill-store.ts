import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { filterSortSkills } from "../shared/skill-filters";
import type {
  AiImportRequest,
  AiImportResult,
  ImportOptions,
  ImportResult,
  ModelConnectionTestInput,
  ModelConnectionTestResult,
  ModelConfig,
  ModelConfigInput,
  SkillExportPayload,
  SkillInput,
  SkillListFilters,
  SkillRecord,
  SkillUpdate
} from "../shared/types";

interface SkillRow {
  id: string;
  name: string;
  summary: string;
  category: string;
  tags_json: string;
  scenario: string;
  install_steps_json: string;
  install_commands_json: string;
  source_url: string;
  platforms_json: string;
  notes: string;
  view_count: number;
  last_viewed_at: string;
  favorite: number;
  created_at: string;
  updated_at: string;
}

interface SettingRow {
  key: string;
  value_json: string;
}

interface StoredModelConfig {
  provider: "deepseek";
  baseUrl: string;
  model: string;
  apiKey: string;
  updatedAt: string;
}

export interface SkillStore {
  list(filters: SkillListFilters): SkillRecord[];
  get(id: string): SkillRecord | undefined;
  create(input: SkillInput): SkillRecord;
  update(id: string, patch: SkillUpdate): SkillRecord;
  remove(id: string): boolean;
  recordView(id: string): SkillRecord;
  toggleFavorite(id: string): SkillRecord;
  generateAiDraft(request: AiImportRequest, fetchImpl?: typeof fetch): Promise<AiImportResult>;
  getModelConfig(): ModelConfig;
  updateModelConfig(input: ModelConfigInput): ModelConfig;
  testModelConnection(input: ModelConnectionTestInput, fetchImpl?: typeof fetch): Promise<ModelConnectionTestResult>;
  exportJson(): SkillExportPayload;
  importJson(payload: unknown, options: ImportOptions): ImportResult;
  close(): void;
}

const modelConfigKey = "model_config";
const defaultModelConfig: StoredModelConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKey: "",
  updatedAt: ""
};
const deepSeekApiHost = "api.deepseek.com";
const maxSourceTextLength = 12_000;

function parseArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 4)}...`;
  }

  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function publicModelConfig(config: StoredModelConfig): ModelConfig {
  return {
    provider: "deepseek",
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyPreview: maskApiKey(config.apiKey),
    updatedAt: config.updatedAt
  };
}

function normalizeModelName(value: string): string {
  const model = value.trim() || defaultModelConfig.model;
  if (model === "deepseek-chat") {
    return "deepseek-v4-flash";
  }

  if (model === "deepseek-reasoner") {
    return "deepseek-v4-pro";
  }

  return model;
}

function normalizeBaseUrl(value: string): string {
  const raw = value.trim() || defaultModelConfig.baseUrl;
  const url = new URL(raw);

  if (url.hostname !== deepSeekApiHost) {
    throw new Error("请输入 DeepSeek API Base URL，例如 https://api.deepseek.com，不是普通网页网址");
  }

  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "") || "";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/, "");
}

function modelConnectionResult(input: {
  ok: boolean;
  model: string;
  message: string;
  startedAt: number;
  statusCode?: number;
}): ModelConnectionTestResult {
  return {
    ok: input.ok,
    provider: "deepseek",
    model: input.model,
    statusCode: input.statusCode,
    message: input.message,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    checkedAt: new Date().toISOString()
  };
}

async function readResponseSummary(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text.trim()) {
      return "";
    }

    return text.trim().slice(0, 180);
  } catch {
    return "";
  }
}

function normalizeSourceUrl(value: string): string {
  const raw = value.trim();
  if (!raw) {
    throw new Error("请输入 Skill 下载网址或资料网址");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入有效的 http/https Skill 下载网址或资料网址");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("仅支持解析 http/https 资料网址");
  }

  return url.toString();
}

function compactSourceText(value: string): string {
  const withoutScripts = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxSourceTextLength);
}

async function fetchSourceText(sourceUrl: string, fetchImpl: typeof fetch): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchImpl(sourceUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,text/markdown,text/plain,application/json;q=0.8,*/*;q=0.1"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await readResponseSummary(response);
      throw new Error(detail ? `资料链接访问失败：HTTP ${response.status}，${detail}` : `资料链接访问失败：HTTP ${response.status}`);
    }

    return compactSourceText(await response.text());
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("资料链接访问超时：15 秒内没有收到响应");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonObjectFromText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced);
    }

    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }

    throw new Error("AI 返回内容不是有效 JSON");
  }
}

function coerceAiDraft(raw: unknown, sourceUrl: string): SkillInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI 返回内容不是有效 Skill 对象");
  }

  const record = raw as Partial<SkillInput>;
  return normalizeInput({
    name: String(record.name ?? ""),
    summary: String(record.summary ?? ""),
    category: "",
    tags: [],
    scenario: String(record.scenario ?? ""),
    installSteps: normalizeArray(record.installSteps),
    installCommands: normalizeArray(record.installCommands),
    sourceUrl,
    platforms: normalizeArray(record.platforms),
    notes: String(record.notes ?? "")
  });
}

function aiImportMessages(request: AiImportRequest, sourceUrl: string, sourceText: string): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "你是一个 Skill 仓库整理助手。",
        "根据用户提供的资料生成一个可编辑 Skill 草稿。",
        "只返回 JSON 对象，不要 Markdown，不要解释。",
        "JSON 字段必须是 name, summary, scenario, installSteps, installCommands, platforms, notes。",
        "installSteps、installCommands、platforms 必须是字符串数组。",
        "summary、scenario、installSteps、notes 等面向用户阅读的信息都必须使用中文。",
        "platforms 必须从资料中提取；资料无法判断时返回空数组，不要填默认平台。",
        "不要编造会执行危险操作的安装命令；不确定时把需要人工确认的内容写进 notes。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `资料网址：${sourceUrl}`,
        `补充要求：${request.note.trim() || "无"}`,
        sourceText
          ? `资料正文：\n${sourceText}`
          : request.allowWebAccess
            ? "资料正文：应用已访问网址，但没有提取到可用文本。"
            : "资料正文：用户未授权应用抓取网页，仅可基于网址和补充要求生成草稿。"
      ].join("\n\n")
    }
  ];
}

async function testDeepSeekConnection(
  config: StoredModelConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ModelConnectionTestResult> {
  const startedAt = Date.now();
  const model = normalizeModelName(config.model);
  const apiKey = config.apiKey.trim();

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(config.baseUrl);
  } catch (error) {
    return modelConnectionResult({
      ok: false,
      model,
      message: error instanceof Error ? error.message : "请输入有效的 DeepSeek API Base URL",
      startedAt
    });
  }

  if (!apiKey) {
    return modelConnectionResult({
      ok: false,
      model,
      message: "请先填写或保存 DeepSeek API Key",
      startedAt
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await readResponseSummary(response);
      return modelConnectionResult({
        ok: false,
        model,
        statusCode: response.status,
        message: detail ? `连接失败：HTTP ${response.status}，${detail}` : `连接失败：HTTP ${response.status}`,
        startedAt
      });
    }

    const payload = await response.json().catch(() => undefined) as { data?: Array<{ id?: unknown }> } | undefined;
    const modelIds = payload?.data?.map((item) => item.id).filter((item): item is string => typeof item === "string") ?? [];

    if (modelIds.length > 0 && !modelIds.includes(model)) {
      return modelConnectionResult({
        ok: false,
        model,
        statusCode: response.status,
        message: `DeepSeek API 可访问，但未返回模型 ${model}`,
        startedAt
      });
    }

    return modelConnectionResult({
      ok: true,
      model,
      statusCode: response.status,
      message: "DeepSeek API 连通测试通过",
      startedAt
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "连接超时：10 秒内没有收到响应"
      : `连接失败：${error instanceof Error ? error.message : "未知错误"}`;
    return modelConnectionResult({
      ok: false,
      model,
      message,
      startedAt
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function generateDeepSeekAiDraft(
  request: AiImportRequest,
  config: StoredModelConfig,
  fetchImpl: typeof fetch = fetch
): Promise<AiImportResult> {
  const sourceUrl = normalizeSourceUrl(request.url);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const model = normalizeModelName(config.model);
  const apiKey = config.apiKey.trim();

  if (!apiKey) {
    throw new Error("请先在模型设置中保存 DeepSeek API Key");
  }

  const sourceText = request.allowWebAccess ? await fetchSourceText(sourceUrl, fetchImpl) : "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: aiImportMessages(request, sourceUrl, sourceText)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await readResponseSummary(response);
      throw new Error(detail ? `AI 解析失败：HTTP ${response.status}，${detail}` : `AI 解析失败：HTTP ${response.status}`);
    }

    const payload = await response.json().catch(() => undefined) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | undefined;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("AI 返回内容为空");
    }

    const draft = coerceAiDraft(parseJsonObjectFromText(content), sourceUrl);
    return {
      sourceUrl,
      networkAccessRequested: request.allowWebAccess,
      modelStatus: "generated",
      preview: request.allowWebAccess
        ? "已抓取资料并调用 DeepSeek 生成草稿，保存前请核对字段。"
        : "已基于网址和补充要求调用 DeepSeek 生成草稿，未抓取网页内容。",
      draft
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("AI 解析超时：30 秒内没有收到模型响应");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeStoredModelConfig(raw: unknown): StoredModelConfig {
  if (!raw || typeof raw !== "object") {
    return defaultModelConfig;
  }

  const parsed = raw as Partial<StoredModelConfig>;
  return {
    provider: "deepseek",
    baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : defaultModelConfig.baseUrl,
    model: typeof parsed.model === "string" && parsed.model.trim() ? normalizeModelName(parsed.model) : defaultModelConfig.model,
    apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : ""
  };
}

function parseStoredModelConfig(value: string): StoredModelConfig {
  try {
    return normalizeStoredModelConfig(JSON.parse(value));
  } catch {
    return defaultModelConfig;
  }
}

function normalizeInput(input: SkillInput): SkillInput & { category: string } {
  const name = input.name.trim();
  const summary = input.summary.trim();

  if (!name) {
    throw new Error("Skill 名称不能为空");
  }

  if (!summary) {
    throw new Error("Skill 简短介绍不能为空");
  }

  return {
    name,
    summary,
    category: input.category?.trim() ?? "",
    tags: normalizeArray(input.tags),
    scenario: input.scenario.trim(),
    installSteps: normalizeArray(input.installSteps),
    installCommands: normalizeArray(input.installCommands),
    sourceUrl: input.sourceUrl.trim(),
    platforms: normalizeArray(input.platforms),
    notes: input.notes.trim()
  };
}

function rowToRecord(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    summary: row.summary,
    category: row.category ?? "",
    tags: parseArray(row.tags_json),
    scenario: row.scenario,
    installSteps: parseArray(row.install_steps_json),
    installCommands: parseArray(row.install_commands_json),
    sourceUrl: row.source_url,
    platforms: parseArray(row.platforms_json),
    notes: row.notes,
    viewCount: Number(row.view_count ?? 0),
    lastViewedAt: row.last_viewed_at ?? "",
    favorite: Boolean(row.favorite),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function payloadSkills(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object" && Array.isArray((payload as { skills?: unknown }).skills)) {
    return (payload as { skills: unknown[] }).skills;
  }

  throw new Error("JSON 格式无效：需要 skills 数组");
}

function coerceImportedSkill(raw: unknown): SkillInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("JSON 格式无效：Skill 条目必须是对象");
  }

  const record = raw as Partial<SkillInput>;
  return normalizeInput({
    name: String(record.name ?? ""),
    summary: String(record.summary ?? ""),
    category: String(record.category ?? ""),
    tags: normalizeArray(record.tags),
    scenario: String(record.scenario ?? ""),
    installSteps: normalizeArray(record.installSteps),
    installCommands: normalizeArray(record.installCommands),
    sourceUrl: String(record.sourceUrl ?? ""),
    platforms: normalizeArray(record.platforms),
    notes: String(record.notes ?? "")
  });
}

function ensureColumn(db: Database.Database, name: string, definition: string): void {
  const columns = db.prepare("PRAGMA table_info(skills)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE skills ADD COLUMN ${definition}`);
  }
}

function ensureSkillMetadataColumns(db: Database.Database): void {
  ensureColumn(db, "category", "category TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "view_count", "view_count INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "last_viewed_at", "last_viewed_at TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "favorite", "favorite INTEGER NOT NULL DEFAULT 0");
}

export function createSkillStore(dbPath: string): SkillStore {
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL,
      scenario TEXT NOT NULL,
      install_steps_json TEXT NOT NULL,
      install_commands_json TEXT NOT NULL,
      source_url TEXT NOT NULL,
      platforms_json TEXT NOT NULL,
      notes TEXT NOT NULL,
      view_count INTEGER NOT NULL DEFAULT 0,
      last_viewed_at TEXT NOT NULL DEFAULT '',
      favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_skills_updated ON skills(updated_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);
  ensureSkillMetadataColumns(db);

  const allRows = db.prepare("SELECT * FROM skills");
  const getById = db.prepare("SELECT * FROM skills WHERE id = ?");
  const getByName = db.prepare("SELECT * FROM skills WHERE name = ?");
  const getSetting = db.prepare("SELECT * FROM app_settings WHERE key = ?");
  const upsertSetting = db.prepare(`
    INSERT INTO app_settings (key, value_json)
    VALUES (@key, @value_json)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `);
  const insert = db.prepare(`
    INSERT INTO skills (
      id, name, summary, category, tags_json, scenario, install_steps_json, install_commands_json,
      source_url, platforms_json, notes, view_count, last_viewed_at, favorite, created_at, updated_at
    ) VALUES (
      @id, @name, @summary, @category, @tags_json, @scenario, @install_steps_json, @install_commands_json,
      @source_url, @platforms_json, @notes, @view_count, @last_viewed_at, @favorite, @created_at, @updated_at
    )
  `);
  const update = db.prepare(`
    UPDATE skills SET
      name = @name,
      summary = @summary,
      category = @category,
      tags_json = @tags_json,
      scenario = @scenario,
      install_steps_json = @install_steps_json,
      install_commands_json = @install_commands_json,
      source_url = @source_url,
      platforms_json = @platforms_json,
      notes = @notes,
      updated_at = @updated_at
    WHERE id = @id
  `);
  const recordView = db.prepare(`
    UPDATE skills SET
      view_count = view_count + 1,
      last_viewed_at = @last_viewed_at
    WHERE id = @id
  `);
  const toggleFavorite = db.prepare(`
    UPDATE skills SET
      favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END
    WHERE id = ?
  `);
  const remove = db.prepare("DELETE FROM skills WHERE id = ?");

  function readAll(): SkillRecord[] {
    return (allRows.all() as SkillRow[]).map(rowToRecord);
  }

  function readById(id: string): SkillRecord | undefined {
    const row = getById.get(id) as SkillRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  function readByName(name: string): SkillRecord | undefined {
    const row = getByName.get(name) as SkillRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  function readStoredModelConfig(): StoredModelConfig {
    const row = getSetting.get(modelConfigKey) as SettingRow | undefined;
    return row ? parseStoredModelConfig(row.value_json) : { ...defaultModelConfig };
  }

  function writeStoredModelConfig(config: StoredModelConfig): ModelConfig {
    upsertSetting.run({
      key: modelConfigKey,
      value_json: JSON.stringify(config)
    });

    return publicModelConfig(config);
  }

  function writeRecord(input: SkillInput, id = randomUUID(), createdAt = new Date().toISOString()): SkillRecord {
    const normalized = normalizeInput(input);
    const updatedAt = new Date().toISOString();
    const record: SkillRecord = {
      id,
      ...normalized,
      viewCount: 0,
      lastViewedAt: "",
      favorite: false,
      createdAt,
      updatedAt
    };

    insert.run({
      id: record.id,
      name: record.name,
      summary: record.summary,
      category: record.category,
      tags_json: JSON.stringify(record.tags),
      scenario: record.scenario,
      install_steps_json: JSON.stringify(record.installSteps),
      install_commands_json: JSON.stringify(record.installCommands),
      source_url: record.sourceUrl,
      platforms_json: JSON.stringify(record.platforms),
      notes: record.notes,
      view_count: record.viewCount,
      last_viewed_at: record.lastViewedAt,
      favorite: record.favorite ? 1 : 0,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });

    return record;
  }

  function updateRecord(id: string, patch: SkillUpdate): SkillRecord {
    const existing = readById(id);
    if (!existing) {
      throw new Error("Skill 条目不存在");
    }

    const merged = normalizeInput({
      name: patch.name ?? existing.name,
      summary: patch.summary ?? existing.summary,
      category: patch.category ?? existing.category,
      tags: patch.tags ?? existing.tags,
      scenario: patch.scenario ?? existing.scenario,
      installSteps: patch.installSteps ?? existing.installSteps,
      installCommands: patch.installCommands ?? existing.installCommands,
      sourceUrl: patch.sourceUrl ?? existing.sourceUrl,
      platforms: patch.platforms ?? existing.platforms,
      notes: patch.notes ?? existing.notes
    });

    const updatedAt = new Date().toISOString();
    update.run({
      id,
      name: merged.name,
      summary: merged.summary,
      category: merged.category,
      tags_json: JSON.stringify(merged.tags),
      scenario: merged.scenario,
      install_steps_json: JSON.stringify(merged.installSteps),
      install_commands_json: JSON.stringify(merged.installCommands),
      source_url: merged.sourceUrl,
      platforms_json: JSON.stringify(merged.platforms),
      notes: merged.notes,
      updated_at: updatedAt
    });

    return {
      id,
      ...merged,
      viewCount: existing.viewCount,
      lastViewedAt: existing.lastViewedAt,
      favorite: existing.favorite,
      createdAt: existing.createdAt,
      updatedAt
    };
  }

  function recordSkillView(id: string): SkillRecord {
    const result = recordView.run({
      id,
      last_viewed_at: new Date().toISOString()
    });
    if (result.changes === 0) {
      throw new Error("Skill 条目不存在");
    }

    return readById(id) as SkillRecord;
  }

  function toggleSkillFavorite(id: string): SkillRecord {
    const result = toggleFavorite.run(id);
    if (result.changes === 0) {
      throw new Error("Skill 条目不存在");
    }

    return readById(id) as SkillRecord;
  }

  function uniqueImportedName(baseName: string): string {
    let index = 2;
    let candidate = `${baseName} (${index})`;
    while (readByName(candidate)) {
      index += 1;
      candidate = `${baseName} (${index})`;
    }
    return candidate;
  }

  return {
    list(filters) {
      return filterSortSkills(readAll(), filters);
    },

    get(id) {
      return readById(id);
    },

    create(input) {
      return writeRecord(input);
    },

    update(id, patch) {
      return updateRecord(id, patch);
    },

    remove(id) {
      return remove.run(id).changes > 0;
    },

    recordView(id) {
      return recordSkillView(id);
    },

    toggleFavorite(id) {
      return toggleSkillFavorite(id);
    },

    generateAiDraft(request, fetchImpl) {
      return generateDeepSeekAiDraft(request, readStoredModelConfig(), fetchImpl);
    },

    getModelConfig() {
      return publicModelConfig(readStoredModelConfig());
    },

    updateModelConfig(input) {
      const existing = readStoredModelConfig();
      const baseUrl = input.baseUrl?.trim() || defaultModelConfig.baseUrl;
      const model = normalizeModelName(input.model ?? existing.model);
      const apiKey = input.clearApiKey ? "" : input.apiKey?.trim() || existing.apiKey;

      return writeStoredModelConfig({
        provider: "deepseek",
        baseUrl,
        model,
        apiKey,
        updatedAt: new Date().toISOString()
      });
    },

    testModelConnection(input, fetchImpl) {
      const existing = readStoredModelConfig();
      return testDeepSeekConnection(
        {
          provider: "deepseek",
          baseUrl: input.baseUrl?.trim() || existing.baseUrl || defaultModelConfig.baseUrl,
          model: input.model?.trim() || existing.model || defaultModelConfig.model,
          apiKey: input.apiKey?.trim() || existing.apiKey,
          updatedAt: existing.updatedAt
        },
        fetchImpl
      );
    },

    exportJson() {
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        skills: filterSortSkills(readAll(), { query: "", filter: "all", sort: "name" })
      };
    },

    importJson(payload, options) {
      const result: ImportResult = { created: 0, overwritten: 0, skipped: 0, renamed: 0 };
      const importOne = db.transaction((items: unknown[]) => {
        items.forEach((item) => {
          const input = coerceImportedSkill(item);
          const existing = readByName(input.name);

          if (existing && options.conflictMode === "skip") {
            result.skipped += 1;
            return;
          }

          if (existing && options.conflictMode === "overwrite") {
            updateRecord(existing.id, input);
            result.overwritten += 1;
            return;
          }

          if (existing && options.conflictMode === "rename") {
            writeRecord({ ...input, name: uniqueImportedName(input.name) });
            result.created += 1;
            result.renamed += 1;
            return;
          }

          writeRecord(input);
          result.created += 1;
        });
      });

      importOne(payloadSkills(payload));
      return result;
    },

    close() {
      db.close();
    }
  };
}
