import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillStore, type SkillStore } from "../src/main/skill-store";

let dir = "";
let store: SkillStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "skill-repo-"));
  store = createSkillStore(path.join(dir, "skills.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("SQLite skill store", () => {
  it("persists manually created skills and supports search plus tag filtering", () => {
    const created = store.create({
      name: "frontend-design",
      summary: "创建高质量前端界面",
      category: "设计",
      tags: ["前端", "UI"],
      scenario: "用于 Web UI 原型",
      installSteps: ["确认目标", "生成界面"],
      installCommands: ["codex skill install frontend-design"],
      sourceUrl: "https://example.com/frontend-design",
      platforms: ["Windows", "Codex"],
      notes: "本地保存"
    });

    store.close();
    store = createSkillStore(path.join(dir, "skills.sqlite"));

    expect(store.get(created.id)?.name).toBe("frontend-design");
    expect(store.get(created.id)).toMatchObject({
      category: "设计",
      viewCount: 0,
      lastViewedAt: "",
      favorite: false
    });
    expect(
      store.list({ query: "Web UI", filter: "设计", sort: "updated" }).map((item) => item.id)
    ).toEqual([created.id]);
  });

  it("creates uncategorized skills by default and lets users change category", () => {
    const created = store.create({
      name: "uncategorized-skill",
      summary: "默认未分类",
      tags: ["不会作为分类"],
      scenario: "",
      installSteps: [],
      installCommands: [],
      sourceUrl: "",
      platforms: [],
      notes: ""
    });

    expect(created.category).toBe("");
    expect(store.list({ query: "", filter: "uncategorized", sort: "updated" }).map((item) => item.id)).toEqual([created.id]);
    expect(store.list({ query: "", filter: "不会作为分类", sort: "updated" })).toHaveLength(0);

    const categorized = store.update(created.id, { category: "开发工具" });
    expect(categorized.category).toBe("开发工具");
    expect(store.list({ query: "", filter: "开发工具", sort: "updated" }).map((item) => item.id)).toEqual([created.id]);

    const cleared = store.update(created.id, { category: "" });
    expect(cleared.category).toBe("");
    expect(store.list({ query: "", filter: "uncategorized", sort: "updated" }).map((item) => item.id)).toEqual([created.id]);
  });

  it("migrates existing databases with category and skill usage metadata defaults", () => {
    const dbPath = path.join(dir, "legacy.sqlite");
    store.close();
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        scenario TEXT NOT NULL,
        install_steps_json TEXT NOT NULL,
        install_commands_json TEXT NOT NULL,
        source_url TEXT NOT NULL,
        platforms_json TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO skills (
        id, name, summary, tags_json, scenario, install_steps_json, install_commands_json,
        source_url, platforms_json, notes, created_at, updated_at
      ) VALUES (
        'legacy', 'legacy-skill', '旧库条目', '[]', '', '[]', '[]',
        '', '[]', '', '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
      );
    `);
    legacyDb.close();

    store = createSkillStore(dbPath);

    expect(store.get("legacy")).toMatchObject({
      category: "",
      viewCount: 0,
      lastViewedAt: "",
      favorite: false
    });
  });

  it("records skill views and toggles favorites without changing view count", () => {
    const created = store.create({
      name: "frequent-skill",
      summary: "常用条目",
      tags: [],
      scenario: "",
      installSteps: [],
      installCommands: [],
      sourceUrl: "",
      platforms: [],
      notes: ""
    });

    const viewed = store.recordView(created.id);
    expect(viewed.viewCount).toBe(1);
    expect(viewed.lastViewedAt).not.toBe("");

    const favorite = store.toggleFavorite(created.id);
    expect(favorite.favorite).toBe(true);
    expect(favorite.viewCount).toBe(1);

    const unfavorite = store.toggleFavorite(created.id);
    expect(unfavorite.favorite).toBe(false);
    expect(unfavorite.viewCount).toBe(1);
  });

  it("updates and deletes a skill without executing install commands", () => {
    const created = store.create({
      name: "lark-doc",
      summary: "读取飞书云文档",
      tags: ["飞书"],
      scenario: "文档处理",
      installSteps: ["认证", "读取"],
      installCommands: ["lark-cli doc read --url <url>"],
      sourceUrl: "https://example.com/lark-doc",
      platforms: ["Windows"],
      notes: ""
    });

    const updated = store.update(created.id, {
      summary: "读取和编辑飞书云文档",
      category: "文档",
      tags: ["飞书", "文档处理"]
    });

    expect(updated.summary).toBe("读取和编辑飞书云文档");
    expect(updated.category).toBe("文档");
    expect(updated.tags).toEqual(["飞书", "文档处理"]);
    expect(store.remove(created.id)).toBe(true);
    expect(store.get(created.id)).toBeUndefined();
  });

  it("imports JSON with overwrite, skip, and rename conflict modes", () => {
    store.create({
      name: "frontend-design",
      summary: "旧简介",
      tags: ["前端"],
      scenario: "",
      installSteps: [],
      installCommands: [],
      sourceUrl: "",
      platforms: ["Windows"],
      notes: ""
    });

    const payload = {
      version: 1,
      skills: [
        {
          name: "frontend-design",
          summary: "新简介",
          tags: ["UI"],
          scenario: "界面",
          installSteps: ["安装"],
          installCommands: ["codex skill install frontend-design"],
          sourceUrl: "https://example.com/new",
          platforms: ["Windows", "Codex"],
          notes: "导入"
        }
      ]
    };

    expect(store.importJson(payload, { conflictMode: "skip" })).toMatchObject({ created: 0, skipped: 1 });
    expect(store.list({ query: "旧简介", filter: "all", sort: "updated" })).toHaveLength(1);

    expect(store.importJson(payload, { conflictMode: "rename" })).toMatchObject({ created: 1, renamed: 1 });
    expect(store.list({ query: "frontend-design", filter: "all", sort: "name" })).toHaveLength(2);

    expect(store.importJson(payload, { conflictMode: "overwrite" })).toMatchObject({ overwritten: 1 });
    expect(store.list({ query: "新简介", filter: "all", sort: "updated" })).toHaveLength(2);
  });

  it("persists DeepSeek model configuration without returning the full API key", () => {
    expect(store.getModelConfig()).toMatchObject({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyConfigured: false,
      apiKeyPreview: ""
    });

    const saved = store.updateModelConfig({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      apiKey: "test-key-1234567890abcdef"
    });

    expect(saved).toMatchObject({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      apiKeyConfigured: true,
      apiKeyPreview: "test...cdef"
    });
    expect(JSON.stringify(saved)).not.toContain("1234567890");

    store.close();
    store = createSkillStore(path.join(dir, "skills.sqlite"));

    expect(store.getModelConfig()).toMatchObject({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      apiKeyConfigured: true,
      apiKeyPreview: "test...cdef"
    });

    const updated = store.updateModelConfig({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash"
    });

    expect(updated.apiKeyPreview).toBe("test...cdef");
  });

  it("migrates legacy DeepSeek model names to current V4 model names", () => {
    expect(store.updateModelConfig({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: ""
    }).model).toBe("deepseek-v4-flash");

    expect(store.updateModelConfig({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-reasoner",
      apiKey: ""
    }).model).toBe("deepseek-v4-pro");
  });

  it("tests DeepSeek API connection with the saved API key without leaking it", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek-v4-flash" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    store.updateModelConfig({
      baseUrl: "https://api.deepseek.com/",
      model: "deepseek-v4-flash",
      apiKey: "test-key-saved-secret-1234"
    });

    const result = await store.testModelConnection(
      { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKey: "" },
      fakeFetch
    );

    expect(result).toMatchObject({
      ok: true,
      provider: "deepseek",
      statusCode: 200,
      model: "deepseek-v4-flash"
    });
    expect(result.message).toContain("连通");
    expect(JSON.stringify(result)).not.toContain("test-key-saved-secret-1234");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/models");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer test-key-saved-secret-1234"
    });
    expect(calls[0].init.body).toBeUndefined();
  });

  it("tests DeepSeek connection with a temporary API key over the saved key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ object: "list", data: [{ id: "deepseek-v4-pro" }] }), { status: 200 });
    };

    store.updateModelConfig({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "test-key-saved-secret-1234"
    });

    const result = await store.testModelConnection(
      { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", apiKey: "test-key-temp-secret-5678" },
      fakeFetch
    );

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("test-key-temp-secret-5678");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer test-key-temp-secret-5678"
    });
  });

  it("does not send a DeepSeek connection request without an API key", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };

    const result = await store.testModelConnection(
      { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKey: "" },
      fakeFetch
    );

    expect(called).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      provider: "deepseek",
      model: "deepseek-v4-flash"
    });
    expect(result.message).toContain("API Key");
  });

  it("does not send a DeepSeek connection request to a regular website URL", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };

    const result = await store.testModelConnection(
      { baseUrl: "https://www.deepseek.com", model: "deepseek-v4-flash", apiKey: "test-key-secret" },
      fakeFetch
    );

    expect(called).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      provider: "deepseek",
      model: "deepseek-v4-flash"
    });
    expect(result.message).toContain("API Base URL");
  });

  it("generates an AI draft by fetching the source URL and calling DeepSeek", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });

      if (url === "https://github.com/example/awesome-skill") {
        return new Response("<h1>Awesome Skill</h1><p>Install with codex skill install awesome-skill.</p>", {
          status: 200,
          headers: { "content-type": "text/html" }
        });
      }

      if (url === "https://api.deepseek.com/chat/completions") {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                name: "awesome-skill",
                summary: "从 README 解析出的 Skill",
                category: "自动化",
                tags: ["AI 导入", "自动化"],
                scenario: "用于自动化任务",
                installSteps: ["运行安装命令"],
                installCommands: ["codex skill install awesome-skill"],
                platforms: ["Codex"],
                notes: "由 DeepSeek 解析生成"
              })
            }
          }]
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response("not found", { status: 404 });
    };

    store.updateModelConfig({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "test-key-saved-secret-1234"
    });

    const result = await store.generateAiDraft({
      url: "https://github.com/example/awesome-skill",
      note: "安装步骤简短",
      allowWebAccess: true
    }, fakeFetch);

    expect(result.modelStatus).toBe("generated");
    expect(result.preview).toContain("DeepSeek");
    expect(result.draft).toMatchObject({
      name: "awesome-skill",
      summary: "从 README 解析出的 Skill",
      category: "",
      tags: [],
      sourceUrl: "https://github.com/example/awesome-skill"
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://github.com/example/awesome-skill",
      "https://api.deepseek.com/chat/completions"
    ]);
    expect(calls[1].init.method).toBe("POST");
    expect(calls[1].init.headers).toMatchObject({
      Authorization: "Bearer test-key-saved-secret-1234",
      "Content-Type": "application/json"
    });
    const modelRequest = JSON.parse(String(calls[1].init.body)) as {
      messages: Array<{ content: string }>;
    };
    const prompt = modelRequest.messages.map((message) => message.content).join("\n");
    expect(prompt).toContain("Awesome Skill");
    expect(prompt).toContain("安装步骤简短");
    expect(prompt).not.toContain("category");
    expect(prompt).not.toContain("tags");
    expect(prompt).toContain("platforms 必须从资料中提取");
    expect(JSON.stringify(result)).not.toContain("test-key-saved-secret-1234");
  });

  it("requires a saved DeepSeek API key before AI link parsing", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response(null, { status: 200 });
    };

    await expect(store.generateAiDraft({
      url: "https://github.com/example/awesome-skill",
      note: "",
      allowWebAccess: true
    }, fakeFetch)).rejects.toThrow("API Key");

    expect(called).toBe(false);
  });
});
