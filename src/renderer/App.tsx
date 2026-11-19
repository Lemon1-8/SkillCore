import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Folder,
  Heart,
  FileArchive,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff
} from "lucide-react";
import { hasModelConnectionApi } from "../shared/api";
import { collectCategories, collectCommonSkills, filterSortSkills, isNewCategory, suggestCategories } from "../shared/skill-filters";
import type { CategoryOption } from "../shared/skill-filters";
import type {
  AiImportResult,
  ModelConnectionTestResult,
  ModelConfig,
  SkillInput,
  SkillListFilters,
  SkillRecord,
  SkillSort
} from "../shared/types";
import brandAvatarUrl from "./assets/brand-avatar.png";
import { createHomeNavigationState, homeFilters } from "./home-navigation";

type WorkspaceMode = "browse" | "ai" | "archive" | "view" | "edit" | "settings";

interface EditorForm {
  name: string;
  summary: string;
  category: string;
  scenario: string;
  installSteps: string;
  installCommands: string;
  sourceUrl: string;
  platforms: string;
  notes: string;
}

interface SettingsForm {
  baseUrl: string;
  model: string;
  apiKey: string;
}

const defaultFilters = homeFilters;
let toastTimer = 0;

const emptyForm: EditorForm = {
  name: "",
  summary: "",
  category: "",
  scenario: "",
  installSteps: "",
  installCommands: "",
  sourceUrl: "",
  platforms: "",
  notes: ""
};

const defaultSettingsForm: SettingsForm = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  apiKey: ""
};

function splitComma(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function splitLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function formFromSkill(skill?: SkillRecord | SkillInput): EditorForm {
  if (!skill) {
    return emptyForm;
  }

  return {
    name: skill.name,
    summary: skill.summary,
    category: skill.category ?? "",
    scenario: skill.scenario,
    installSteps: skill.installSteps.join("\n"),
    installCommands: skill.installCommands.join("\n\n"),
    sourceUrl: skill.sourceUrl,
    platforms: skill.platforms.join(", "),
    notes: skill.notes
  };
}

function settingsFormFromConfig(config?: ModelConfig): SettingsForm {
  return {
    baseUrl: config?.baseUrl ?? defaultSettingsForm.baseUrl,
    model: config?.model ?? defaultSettingsForm.model,
    apiKey: ""
  };
}

function inputFromForm(form: EditorForm): SkillInput {
  return {
    name: form.name.trim(),
    summary: form.summary.trim(),
    category: form.category.trim(),
    tags: [],
    scenario: form.scenario.trim(),
    installSteps: splitLines(form.installSteps),
    installCommands: splitLines(form.installCommands),
    sourceUrl: form.sourceUrl.trim(),
    platforms: splitComma(form.platforms),
    notes: form.notes
  };
}

function fullInstructions(skill: SkillRecord): string {
  const steps = skill.installSteps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const commands = skill.installCommands.join("\n\n");
  const sections = [
    `# ${skill.name}`,
    "",
    skill.summary,
  ];

  if (skill.scenario) {
    sections.push("", "## 适用场景", skill.scenario);
  }

  if (steps || commands) {
    sections.push("", "## 安装步骤");
    if (steps) {
      sections.push(steps);
    }
    if (commands) {
      sections.push("", "## 安装命令", commands);
    }
  }

  if (skill.sourceUrl) {
    sections.push("", "## 来源", skill.sourceUrl);
  }

  if (skill.notes) {
    sections.push("", "## 备注", skill.notes);
  }

  return sections.join("\n");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function App() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [filters, setFilters] = useState<SkillListFilters>(defaultFilters);
  const [activeId, setActiveId] = useState<string>();
  const [mode, setMode] = useState<WorkspaceMode>("browse");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editorForm, setEditorForm] = useState<EditorForm>(emptyForm);
  const [editorDirty, setEditorDirty] = useState(false);
  const [aiUrl, setAiUrl] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [allowWebAccess, setAllowWebAccess] = useState(true);
  const [aiDraft, setAiDraft] = useState<AiImportResult>();
  const [aiBusy, setAiBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<{ message: string; fileName?: string }>();
  const [modelConfig, setModelConfig] = useState<ModelConfig>();
  const [settingsForm, setSettingsForm] = useState<SettingsForm>(defaultSettingsForm);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ModelConnectionTestResult>();
  const [listToolsCollapsed, setListToolsCollapsed] = useState(false);

  const visibleSkills = useMemo(() => filterSortSkills(skills, filters), [skills, filters]);
  const activeSkill = useMemo(() => skills.find((skill) => skill.id === activeId), [activeId, skills]);
  const categories = useMemo(() => collectCategories(skills), [skills]);
  const commonSkills = useMemo(() => collectCommonSkills(skills), [skills]);
  const uncategorizedCount = skills.filter((skill) => !skill.category).length;
  const recentCount = Math.min(skills.length, 5);
  const hasSkillDetail = mode === "view" && Boolean(activeSkill);
  const browsingCardsOnly = mode === "browse" || (mode === "view" && !activeSkill);
  const collapseListPane = listToolsCollapsed && !browsingCardsOnly;

  useEffect(() => {
    void refreshSkills().finally(() => setLoading(false));
    void refreshModelConfig();
  }, []);

  useEffect(() => {
    if (activeId && !skills.some((skill) => skill.id === activeId)) {
      setActiveId(undefined);
      if (mode === "view") {
        setMode("browse");
      }
    }
  }, [activeId, mode, skills]);

  function showToast(message: string): void {
    setToast(message);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => setToast(""), 1800);
  }

  async function refreshSkills(preferredId?: string): Promise<SkillRecord[]> {
    const list = await window.skillRepo.listSkills({ query: "", filter: "all", sort: "updated" });
    setSkills(list);
    if (preferredId) {
      setActiveId(preferredId);
    } else if (activeId && !list.some((skill) => skill.id === activeId)) {
      setActiveId(undefined);
    }
    return list;
  }

  async function refreshModelConfig(): Promise<void> {
    const config = await window.skillRepo.getModelConfig();
    setModelConfig(config);
    setSettingsForm(settingsFormFromConfig(config));
    setSettingsDirty(false);
    setConnectionResult(undefined);
  }

  function canLeaveEditor(): boolean {
    if (archiveBusy) {
      showToast("正在解析 ZIP，请稍候");
      return false;
    }
    return mode !== "edit" || !editorDirty || window.confirm("放弃未保存的修改？");
  }

  function setFilter(filter: string): void {
    if (!canLeaveEditor()) {
      return;
    }

    setFilters((current) => ({ ...current, filter }));
  }

  async function selectSkill(skill: SkillRecord): Promise<void> {
    if (!canLeaveEditor()) {
      return;
    }

    try {
      const viewed = await window.skillRepo.recordSkillView(skill.id);
      setSkills((current) => current.map((item) => item.id === viewed.id ? viewed : item));
      setActiveId(viewed.id);
      setMode("view");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "打开 Skill 失败");
    }
  }

  async function toggleFavorite(skill: SkillRecord): Promise<void> {
    try {
      const updated = await window.skillRepo.toggleSkillFavorite(skill.id);
      setSkills((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      showToast(error instanceof Error ? error.message : "收藏状态更新失败");
    }
  }

  function closeSkillDetail(): void {
    setActiveId(undefined);
    setListToolsCollapsed(false);
    setMode("browse");
  }

  function openHome(): void {
    if (!canLeaveEditor()) {
      return;
    }

    const home = createHomeNavigationState();
    setActiveId(home.activeId);
    setFilters(home.filters);
    setListToolsCollapsed(home.listToolsCollapsed);
    setMode(home.mode);
  }

  function openAiImport(): void {
    if (!canLeaveEditor()) {
      return;
    }

    setMode("ai");
  }

  function openSettings(): void {
    if (!canLeaveEditor()) {
      return;
    }

    setMode("settings");
    void refreshModelConfig().catch((error: unknown) => {
      showToast(error instanceof Error ? error.message : "读取设置失败");
    });
  }

  function openArchiveImport(): void {
    if (!canLeaveEditor()) {
      return;
    }

    setArchiveError(undefined);
    setMode("archive");
    void importSkillArchive();
  }

  async function importSkillArchive(): Promise<void> {
    if (archiveBusy) return;
    setArchiveBusy(true);
    setArchiveError(undefined);
    try {
      if (typeof window.skillRepo.importSkillArchive !== "function") {
        throw new Error("请重新启动应用以启用 ZIP 导入。");
      }
      const result = await window.skillRepo.importSkillArchive();
      if (result.status === "invalid") {
        setArchiveError({ message: result.message, fileName: result.fileName });
      } else if (result.status === "imported") {
        setSkills((current) => [result.skill, ...current]);
        setActiveId(result.skill.id);
        setFilters(defaultFilters);
        setMode("view");
        showToast(`已导入「${result.skill.name}」`);
      }
    } catch (error) {
      setArchiveError({ message: error instanceof Error ? error.message : "ZIP 导入失败，请重试。" });
    } finally {
      setArchiveBusy(false);
    }
  }

  async function exportSkillArchive(skill: SkillRecord): Promise<void> {
    try {
      const result = await window.skillRepo.exportSkillArchive(skill.id);
      if (!result.canceled) showToast("原始 ZIP 已导出");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "导出原始 ZIP 失败");
    }
  }

  function openEditor(skill: SkillRecord): void {
    if (!canLeaveEditor()) {
      return;
    }

    setEditingId(skill.id);
    setEditorForm(formFromSkill(skill));
    setEditorDirty(false);
    setMode("edit");
  }

  function updateEditorField(field: keyof EditorForm, value: string): void {
    setEditorForm((current) => ({ ...current, [field]: value }));
    setEditorDirty(true);
  }

  function updateSettingsField(field: keyof SettingsForm, value: string): void {
    setSettingsForm((current) => ({ ...current, [field]: value }));
    setSettingsDirty(true);
    setConnectionResult(undefined);
  }

  async function copyText(text: string, message: string): Promise<void> {
    await navigator.clipboard.writeText(text);
    showToast(message);
  }

  async function saveEditor(event: FormEvent): Promise<void> {
    event.preventDefault();
    const input = inputFromForm(editorForm);

    if (!input.name || !input.summary) {
      showToast("名称和简短介绍必填");
      return;
    }

    try {
      const saved = editingId
        ? await window.skillRepo.updateSkill(editingId, input)
        : await window.skillRepo.createSkill(input);
      setEditorDirty(false);
      await refreshSkills(saved.id);
      setMode("view");
      showToast("Skill 已保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败");
    }
  }

  async function deleteSkill(skill?: SkillRecord): Promise<void> {
    const target = skill ?? activeSkill;
    if (!target) {
      return;
    }

    if (!window.confirm(`确认删除「${target.name}」？此操作不可撤销。`)) {
      return;
    }

    await window.skillRepo.deleteSkill(target.id);
    const list = await refreshSkills();
    setMode(list.length > 0 ? "browse" : "browse");
    setEditorDirty(false);
    showToast("Skill 已删除");
  }

  async function generateAiDraft(): Promise<void> {
    setAiBusy(true);
    try {
      const result = await window.skillRepo.generateAiDraft({
        url: aiUrl,
        note: aiNote,
        allowWebAccess
      });
      setAiDraft(result);
      showToast("已生成 AI 草稿");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "生成失败");
    } finally {
      setAiBusy(false);
    }
  }

  async function saveAiDraft(): Promise<void> {
    if (!aiDraft) {
      showToast("请先生成草稿");
      return;
    }

    try {
      const saved = await window.skillRepo.createSkill(aiDraft.draft);
      await refreshSkills(saved.id);
      setMode("view");
      showToast("AI 草稿已保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存草稿失败");
    }
  }

  async function saveModelSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    const baseUrl = settingsForm.baseUrl.trim();
    const model = settingsForm.model.trim();

    if (!baseUrl || !model) {
      showToast("API Base URL 和模型名必填");
      return;
    }

    try {
      const saved = await window.skillRepo.updateModelConfig({
        baseUrl,
        model,
        apiKey: settingsForm.apiKey.trim() || undefined
      });
      setModelConfig(saved);
      setSettingsForm(settingsFormFromConfig(saved));
      setSettingsDirty(false);
      setConnectionResult(undefined);
      showToast("模型配置已保存");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存设置失败");
    }
  }

  async function clearModelApiKey(): Promise<void> {
    try {
      const saved = await window.skillRepo.updateModelConfig({
        baseUrl: settingsForm.baseUrl,
        model: settingsForm.model,
        clearApiKey: true
      });
      setModelConfig(saved);
      setSettingsForm(settingsFormFromConfig(saved));
      setSettingsDirty(false);
      setConnectionResult(undefined);
      showToast("API Key 已清除");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "清除失败");
    }
  }

  async function revealModelApiKey(): Promise<string | undefined> {
    try {
      const savedKey = (await window.skillRepo.revealModelApiKey()).trim();
      if (!savedKey) {
        showToast("尚未保存 API Key");
        return undefined;
      }

      return savedKey;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "读取 API Key 失败");
      return undefined;
    }
  }

  async function copyModelApiKey(): Promise<void> {
    const savedKey = await revealModelApiKey();
    if (savedKey) {
      await copyText(savedKey, "API Key 已复制");
    }
  }

  async function testModelConnection(): Promise<void> {
    const baseUrl = settingsForm.baseUrl.trim();
    const model = settingsForm.model.trim();

    if (!baseUrl || !model) {
      showToast("API Base URL 和模型名必填");
      return;
    }

    if (!hasModelConnectionApi(window.skillRepo)) {
      const checkedAt = new Date().toISOString();
      setConnectionResult({
        ok: false,
        provider: "deepseek",
        model,
        message: "当前窗口尚未加载模型连接接口，请重启应用后再测试",
        latencyMs: 0,
        checkedAt
      });
      showToast("请重启应用后再测试连接");
      return;
    }

    setConnectionBusy(true);
    try {
      const result = await window.skillRepo.testModelConnection({
        baseUrl,
        model,
        apiKey: settingsForm.apiKey.trim()
      });
      setConnectionResult(result);
      showToast(result.ok ? "连接测试通过" : "连接测试失败");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setConnectionBusy(false);
    }
  }

  async function openSource(skill: SkillRecord): Promise<void> {
    if (!skill.sourceUrl) {
      showToast("没有来源链接");
      return;
    }

    try {
      await window.skillRepo.openExternal(skill.sourceUrl);
    } catch {
      await copyText(skill.sourceUrl, "非网页来源已复制");
    }
  }

  const emptyTitle = skills.length === 0
    ? "当前还没有 Skill 条目"
    : filters.filter === "recent"
      ? "最近没有更新的 Skill"
      : filters.filter === "uncategorized"
        ? "没有未分类 Skill"
        : "没有找到匹配的 Skill";
  const emptyAction = skills.length === 0 ? "导入 Skill ZIP 或使用 AI 导入" : filters.filter !== "all" ? "查看全部 Skills" : "清空搜索";

  return (
    <main className={`app-shell ${collapseListPane ? "list-pane-collapsed" : ""} ${browsingCardsOnly ? "browse-mode" : ""} ${hasSkillDetail ? "detail-active" : ""}`}>
      <aside className="sidebar" aria-label="左侧导航">
        <button className="brand brand-button" type="button" title="返回首页" aria-label="返回首页" onClick={openHome}>
          <img className="brand-avatar" src={brandAvatarUrl} alt="" />
          <div>
            <h1 className="brand-title">个人 Skill 仓库</h1>
            <p className="brand-subtitle">本地 SQLite</p>
          </div>
        </button>

        <section className="nav-section">
          <p className="section-title">视图</p>
          <NavButton active={filters.filter === "all"} icon={<Database size={16} />} label="全部 Skills" count={skills.length} onClick={() => setFilter("all")} />
          <NavButton active={filters.filter === "recent"} icon={<Filter size={16} />} label="最近更新" count={recentCount} onClick={() => setFilter("recent")} />
          <NavButton active={filters.filter === "uncategorized"} icon={<Folder size={16} />} label="未分类" count={uncategorizedCount} onClick={() => setFilter("uncategorized")} />
        </section>

        {categories.length > 0 && (
          <section className="nav-section category-section">
            <p className="section-title">分类</p>
            {categories.map((category) => (
              <NavButton
                key={category.name}
                active={filters.filter === category.name}
                icon={<Folder size={16} />}
                label={category.name}
                count={category.count}
                onClick={() => setFilter(category.name)}
              />
            ))}
          </section>
        )}

        {commonSkills.length > 0 && (
          <section className="nav-section common-skill-section">
            <p className="section-title">常用Skill</p>
            {commonSkills.map((skill) => (
              <CommonSkillButton
                key={skill.id}
                skill={skill}
                active={skill.id === activeId && mode === "view"}
                onSelect={() => void selectSkill(skill)}
                onToggleFavorite={() => void toggleFavorite(skill)}
              />
            ))}
          </section>
        )}

        <div className="sidebar-footer">
          <button className="tool-button settings-button" title="模型设置（DeepSeek API Key）" aria-label="设置" onClick={openSettings}>
            <Settings size={16} />
            <span>设置</span>
          </button>
        </div>
      </aside>

      <section className={`list-pane ${collapseListPane ? "collapsed" : ""}`} aria-label="Skill 列表">
        {collapseListPane ? (
          <div className="list-rail">
            <button className="rail-toggle-button" title="展开 Skill 列表" aria-label="展开 Skill 列表" onClick={() => setListToolsCollapsed(false)}>
              <ChevronRight size={18} />
            </button>
            <span className="rail-count">{loading ? "..." : visibleSkills.length}</span>
          </div>
        ) : (
          <>
            <div className="list-header">
              <div className="search-row">
                <div className="search-box">
                  <Search size={16} />
                  <input value={filters.query} placeholder="搜索名称、简介、分类、场景..." onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} />
                </div>
                <button className="ai-button" onClick={openAiImport}>
                  <Sparkles size={16} />
                  AI 导入
                </button>
                <button className="icon-button" title="导入 Skill ZIP" aria-label="导入 Skill ZIP" onClick={openArchiveImport} disabled={archiveBusy}>
                  <FileArchive size={19} />
                </button>
                {!browsingCardsOnly && (
                  <button className="tool-toggle-button icon-only" title="收起 Skill 列表" aria-label="收起 Skill 列表" onClick={() => setListToolsCollapsed(true)}>
                    <ChevronLeft size={17} />
                  </button>
                )}
              </div>
              <div className="filter-row">
                <select value={filters.sort} aria-label="排序" onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as SkillSort }))}>
                  <option value="updated">最近更新</option>
                  <option value="name">名称 A-Z</option>
                  <option value="created">创建时间</option>
                </select>
                <span className="result-count">{loading ? "读取中" : `${visibleSkills.length} 项`}</span>
              </div>
            </div>

            <div className="skill-list">
              {visibleSkills.map((skill) => (
                <button key={skill.id} className={`skill-card ${skill.id === activeId && mode === "view" ? "active" : ""}`} onClick={() => void selectSkill(skill)}>
                  <div className="card-top">
                    <h3 className="skill-name">{skill.name}</h3>
                    <span className={`source-dot ${skill.sourceUrl ? "online" : ""}`} title={skill.sourceUrl ? "有来源链接" : "无来源链接"} />
                  </div>
                  <p className="skill-desc">{skill.summary}</p>
                  <span className={`category-pill ${skill.category ? "" : "muted"}`}>{skill.category || "未分类"}</span>
                  <div className="meta-line">
                    <span>{formatDate(skill.updatedAt)}</span>
                    <span>安装说明可复制</span>
                  </div>
                </button>
              ))}

              {!loading && visibleSkills.length === 0 && (
                <div className="empty-list">
                  <strong>{emptyTitle}</strong>
                  <span>{emptyAction}</span>
                  <div className="empty-actions">
                    <button className="secondary-button" onClick={() => setFilters(defaultFilters)}>
                      清空筛选
                    </button>
                    <button className="primary-button" onClick={openArchiveImport} disabled={archiveBusy}>
                      导入 Skill ZIP
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {!browsingCardsOnly && <section className={`detail-pane ${mode === "ai" ? "ai-mode" : ""}`} aria-label="Skill 详情">
        <div className="detail-toolbar">
          <div className="crumb">Skill / <span>{mode === "ai" ? "AI 导入" : mode === "archive" ? "ZIP 导入" : mode === "edit" ? "编辑" : mode === "settings" ? "设置" : activeSkill?.name ?? "详情"}</span></div>
          {mode === "view" && activeSkill && (
            <div className="toolbar-actions">
              <button className="secondary-button" onClick={() => copyText(fullInstructions(activeSkill), "完整说明已复制")}>
                <Copy size={15} />
                复制说明
              </button>
              <button className="secondary-button" onClick={closeSkillDetail}>
                <ChevronRight size={15} />
                收起详情
              </button>
              <button className="secondary-button" onClick={() => openEditor(activeSkill)}>
                <Edit3 size={15} />
                编辑
              </button>
              <button className="danger-button" onClick={() => deleteSkill(activeSkill)}>
                <Trash2 size={15} />
                删除
              </button>
            </div>
          )}
        </div>

        <div className="detail-scroll">
          {mode === "ai" && (
            <AiImportPanel
              aiUrl={aiUrl}
              aiNote={aiNote}
              allowWebAccess={allowWebAccess}
              draft={aiDraft}
              busy={aiBusy}
              onUrlChange={setAiUrl}
              onNoteChange={setAiNote}
              onAllowWebAccessChange={setAllowWebAccess}
              onGenerate={generateAiDraft}
              onSaveDraft={saveAiDraft}
              onArchiveImport={openArchiveImport}
            />
          )}

          {mode === "archive" && (
            <SkillArchivePanel busy={archiveBusy} error={archiveError} onImport={importSkillArchive} />
          )}

          {mode === "view" && activeSkill && (
            <SkillDetail skill={activeSkill} onCopyCommand={copyText} onOpenSource={openSource} onExportArchive={exportSkillArchive} />
          )}

          {mode === "settings" && (
            <ModelSettingsPanel
              key={modelConfig?.updatedAt ?? "unsaved"}
              config={modelConfig}
              form={settingsForm}
              dirty={settingsDirty}
              connectionBusy={connectionBusy}
              connectionResult={connectionResult}
              onChange={updateSettingsField}
              onSubmit={saveModelSettings}
              onTestConnection={testModelConnection}
              onReset={() => {
                setSettingsForm(settingsFormFromConfig(modelConfig));
                setSettingsDirty(false);
                setConnectionResult(undefined);
              }}
              onClearApiKey={clearModelApiKey}
              onRevealApiKey={revealModelApiKey}
              onCopyApiKey={copyModelApiKey}
            />
          )}

          {mode === "edit" && (
            <SkillEditor
              form={editorForm}
              categories={categories}
              onChange={updateEditorField}
              onSubmit={saveEditor}
              onCancel={() => {
                if (canLeaveEditor()) {
                  setEditorDirty(false);
                  setMode(activeSkill ? "view" : "browse");
                }
              }}
              onDelete={editingId && activeSkill ? () => deleteSkill(activeSkill) : undefined}
            />
          )}
        </div>
      </section>}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </main>
  );
}

function SkillArchivePanel(props: {
  busy: boolean;
  error?: { message: string; fileName?: string };
  onImport: () => Promise<void>;
}) {
  return (
    <section className="settings-panel archive-panel" aria-labelledby="archive-title" aria-busy={props.busy}>
      <span className="status-badge"><FileArchive size={15} />本地 ZIP 导入</span>
      <h2 className="workspace-title" id="archive-title">导入 Skill 压缩包</h2>
      <p className="workspace-desc">选择包含单个 Skill 的 ZIP。校验通过后自动保存名称、简介和完整正文，同时保留原始压缩包及附件。</p>
      <div className="archive-guide">
        <strong>压缩包需要包含</strong>
        <code>skill-name/SKILL.md</code>
        <span>也支持 SKILL.md 直接位于压缩包根目录。</span>
        <span>SKILL.md 开头需包含 YAML 元数据：name 和 description。</span>
        <span>支持 argument-hint 等 Claude Code 扩展字段。</span>
        <span>scripts、references、assets 等附件为可选。</span>
        <span>ZIP 最大 20 MB，解压内容最大 100 MB，SKILL.md 最大 1 MB，最多 2000 个文件或目录。</span>
      </div>
      {props.error && (
        <div className="archive-error" role="alert">
          <strong>未能导入{props.error.fileName ? `「${props.error.fileName}」` : "压缩包"}</strong>
          <p>{props.error.message}</p>
          <span>修正后重新选择 ZIP 文件。</span>
        </div>
      )}
      <div className="editor-actions">
        <button className="primary-button" type="button" disabled={props.busy} onClick={() => void props.onImport()}>
          <FileArchive size={16} />{props.busy ? "正在解析…" : "选择 ZIP 文件"}
        </button>
        {props.busy && <span role="status">正在校验压缩包并保存 Skill…</span>}
      </div>
    </section>
  );
}

function NavButton(props: { active: boolean; icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button className={`nav-item ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="nav-label">
        {props.icon}
        <span>{props.label}</span>
      </span>
      <span className="count">{props.count}</span>
    </button>
  );
}

function CommonSkillButton(props: {
  skill: SkillRecord;
  active: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className={`common-skill-item ${props.active ? "active" : ""}`}>
      <button className="common-skill-main" onClick={props.onSelect}>
        <span className="nav-label">
          <span className="hash">#</span>
          <span>{props.skill.name}</span>
        </span>
      </button>
      <button
        className={`favorite-button ${props.skill.favorite ? "active" : ""}`}
        title={props.skill.favorite ? "取消收藏" : "收藏"}
        aria-label={props.skill.favorite ? `取消收藏 ${props.skill.name}` : `收藏 ${props.skill.name}`}
        aria-pressed={props.skill.favorite}
        onClick={props.onToggleFavorite}
      >
        <Heart size={14} fill={props.skill.favorite ? "currentColor" : "none"} />
      </button>
      <span className="view-count" title="查看次数">{props.skill.viewCount}</span>
    </div>
  );
}

function ModelSettingsPanel(props: {
  config?: ModelConfig;
  form: SettingsForm;
  dirty: boolean;
  connectionBusy: boolean;
  connectionResult?: ModelConnectionTestResult;
  onChange: (field: keyof SettingsForm, value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onTestConnection: () => Promise<void>;
  onReset: () => void;
  onClearApiKey: () => Promise<void>;
  onRevealApiKey: () => Promise<string | undefined>;
  onCopyApiKey: () => Promise<void>;
}) {
  const [revealedKey, setRevealedKey] = useState<string>();
  const apiKeyStatus = props.config?.apiKeyConfigured ? `已保存 ${props.config.apiKeyPreview}` : "未配置";
  const apiKeyDisplay = revealedKey ?? apiKeyStatus;

  async function toggleApiKey(): Promise<void> {
    if (revealedKey) {
      setRevealedKey(undefined);
      return;
    }

    setRevealedKey(await props.onRevealApiKey());
  }
  const updatedAt = props.config?.updatedAt ? formatDate(props.config.updatedAt) : "尚未保存";
  const connectionDetail = props.connectionResult
    ? [
        props.connectionResult.statusCode ? `HTTP ${props.connectionResult.statusCode}` : undefined,
        `${props.connectionResult.latencyMs} ms`
      ].filter(Boolean).join(" / ")
    : "";

  return (
    <form className="settings-panel" onSubmit={props.onSubmit}>
      <div className="detail-title-row">
        <div>
          <h2 className="workspace-title">模型设置</h2>
          <p className="workspace-desc">当前版本固定使用 DeepSeek。API Base URL 必须是接口地址，例如 https://api.deepseek.com，不是官网或资料网址。</p>
        </div>
        <span className="status-badge">
          <Settings size={15} />
          DeepSeek
        </span>
      </div>

      <div className="settings-grid">
        <Field label="供应商" id="modelProvider">
          <input id="modelProvider" value="DeepSeek" disabled />
        </Field>
        <Field label="当前密钥" id="apiKeyStatus">
          <div className="key-row">
            <input id="apiKeyStatus" value={apiKeyDisplay} disabled />
            <button
              type="button"
              className="mini-button"
              disabled={!props.config?.apiKeyConfigured}
              onClick={() => void toggleApiKey()}
            >
              {revealedKey ? <EyeOff size={14} /> : <Eye size={14} />}
              {revealedKey ? "隐藏" : "显示"}
            </button>
            <button
              type="button"
              className="mini-button"
              disabled={!props.config?.apiKeyConfigured}
              onClick={props.onCopyApiKey}
            >
              <Copy size={14} />
              复制
            </button>
          </div>
        </Field>
        <Field label="API Base URL" id="modelBaseUrl" wide>
          <input id="modelBaseUrl" required value={props.form.baseUrl} onChange={(event) => props.onChange("baseUrl", event.target.value)} />
        </Field>
        <Field label="模型名" id="modelName" wide>
          <input id="modelName" required value={props.form.model} onChange={(event) => props.onChange("model", event.target.value)} />
        </Field>
        <Field label="API Key" id="modelApiKey" wide>
          <input
            id="modelApiKey"
            type="password"
            value={props.form.apiKey}
            placeholder={props.config?.apiKeyConfigured ? "输入新 Key 会覆盖，留空保留当前 Key" : "输入 DeepSeek API Key"}
            onChange={(event) => props.onChange("apiKey", event.target.value)}
          />
        </Field>
      </div>

      <div className="settings-meta">
        <span>更新时间：{updatedAt}</span>
        <span>AI 导入会使用此配置调用 DeepSeek。</span>
        <span>完整 Key 只存于本机配置，点「显示」或「复制」按需取出。</span>
      </div>

      {props.connectionResult && (
        <div className={`connection-result ${props.connectionResult.ok ? "success" : "failure"}`}>
          <strong>{props.connectionResult.ok ? "连接可用" : "连接不可用"}</strong>
          <span>{props.connectionResult.message}</span>
          {connectionDetail && <em>{connectionDetail}</em>}
        </div>
      )}

      <div className="editor-actions split">
        <button type="button" className="danger-button" disabled={!props.config?.apiKeyConfigured} onClick={props.onClearApiKey}>
          清除密钥
        </button>
        <div className="action-cluster">
          <button type="button" className="secondary-button" disabled={!props.dirty} onClick={props.onReset}>取消更改</button>
          <button type="button" className="secondary-button" disabled={props.connectionBusy} onClick={props.onTestConnection}>
            <Wifi size={15} />
            {props.connectionBusy ? "测试中" : "测试连接"}
          </button>
          <button type="submit" className="primary-button">
            <Save size={15} />
            保存配置
          </button>
        </div>
      </div>
    </form>
  );
}

function AiImportPanel(props: {
  aiUrl: string;
  aiNote: string;
  allowWebAccess: boolean;
  draft?: AiImportResult;
  busy: boolean;
  onUrlChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onAllowWebAccessChange: (value: boolean) => void;
  onGenerate: () => void;
  onSaveDraft: () => void;
  onArchiveImport: () => void;
}) {
  return (
    <section className="ai-import-panel">
      <h2 className="workspace-title">AI 导入 Skill 条目</h2>
      <p className="workspace-desc">粘贴 Skill 下载网址或资料网址，生成可编辑草稿。允许联网时会先抓取资料内容，再调用模型解析。</p>

      <div className="ai-form">
        <div className="field">
          <label htmlFor="aiUrl">Skill 下载网址或资料网址</label>
          <div className="ai-url-row">
            <input id="aiUrl" value={props.aiUrl} placeholder="https://github.com/example/awesome-skill" onChange={(event) => props.onUrlChange(event.target.value)} />
            <button className="primary-button" onClick={props.onGenerate} disabled={props.busy}>
              <Sparkles size={15} />
              {props.busy ? "生成中" : "生成草稿"}
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="aiNote">补充要求</label>
          <textarea id="aiNote" value={props.aiNote} placeholder="例如：安装步骤简洁，补充资料以 README 为准。" onChange={(event) => props.onNoteChange(event.target.value)} />
        </div>

        <label className="toggle-line">
          <input type="checkbox" checked={props.allowWebAccess} onChange={(event) => props.onAllowWebAccessChange(event.target.checked)} />
          {props.allowWebAccess ? <Wifi size={16} /> : <WifiOff size={16} />}
          允许应用联网抓取资料内容
        </label>

        {props.draft && (
          <>
            <div className="source-preview">
              <strong>资料来源预览</strong>
              <span>{props.draft.preview}</span>
            </div>

            <div className="draft-grid">
              <DraftItem label="名称" value={props.draft.draft.name} />
              {(props.draft.draft.installSteps.length > 0 || props.draft.draft.installCommands.length > 0) && <DraftItem label="安装方法" value="已生成安装信息" />}
            </div>
          </>
        )}

        <div className="editor-actions">
          <button type="button" className="secondary-button" onClick={props.onArchiveImport}>
            <FileArchive size={15} />
            导入 Skill ZIP
          </button>
          <button type="button" className="primary-button" onClick={props.onSaveDraft} disabled={!props.draft}>
            <Save size={15} />
            保存草稿为 Skill
          </button>
        </div>
      </div>
    </section>
  );
}

function DraftItem(props: { label: string; value: string }) {
  return (
    <div className="draft-item">
      <strong>{props.label}</strong>
      <span>{props.value}</span>
    </div>
  );
}

function SkillDetail(props: {
  skill: SkillRecord;
  onCopyCommand: (text: string, message: string) => Promise<void>;
  onOpenSource: (skill: SkillRecord) => Promise<void>;
  onExportArchive: (skill: SkillRecord) => Promise<void>;
}) {
  const commands = props.skill.installCommands.join("\n\n");
  const category = props.skill.category || "未分类";

  return (
    <div className="viewer">
      <div className="detail-title-row">
        <div>
          <h2 className="workspace-title">{props.skill.name}</h2>
          <p className="workspace-desc">{props.skill.summary}</p>
        </div>
        <span className="status-badge">
          <Copy size={15} />
          可复制安装
        </span>
      </div>

      <div className="detail-stack">
        {props.skill.scenario && (
          <section className="section">
            <h3>适用场景</h3>
            <p className="text-block">{props.skill.scenario}</p>
          </section>
        )}

        {(props.skill.installSteps.length > 0 || commands) && (
          <section className="section">
            <h3>安装步骤</h3>
            {props.skill.installSteps.length > 0 && (
              <ol className="steps">
                {props.skill.installSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            )}
            {commands && (
              <div className="code-block">
                <button className="copy-code" title="复制安装命令" aria-label="复制安装命令" onClick={() => props.onCopyCommand(commands, "安装命令已复制")}>
                  <Copy size={15} />
                </button>
                <code>{commands}</code>
              </div>
            )}
          </section>
        )}

        {props.skill.notes && (
          <section className="section">
            <h3>{props.skill.archiveName ? "Skill 正文" : "备注"}</h3>
            <p className="text-block">{props.skill.notes}</p>
          </section>
        )}

        <section className="section">
          <h3>条目信息</h3>
          <div className="fact-list">
            <div className="fact"><strong>分类</strong><span>{category}</span></div>
            {props.skill.archiveName && (
              <div className="fact"><strong>原始压缩包</strong><button className="link-button" onClick={() => void props.onExportArchive(props.skill)}>{props.skill.archiveName} · 导出原始 ZIP</button></div>
            )}
            {props.skill.platforms.length > 0 && <div className="fact"><strong>平台</strong><span>{props.skill.platforms.join(", ")}</span></div>}
            {props.skill.sourceUrl && <div className="fact"><strong>来源</strong><button className="link-button" onClick={() => props.onOpenSource(props.skill)}>{props.skill.sourceUrl} <ExternalLink size={13} /></button></div>}
            <div className="fact"><strong>创建</strong><span>{formatDate(props.skill.createdAt)}</span></div>
            <div className="fact"><strong>更新</strong><span>{formatDate(props.skill.updatedAt)}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SkillEditor(props: {
  form: EditorForm;
  categories: CategoryOption[];
  onChange: (field: keyof EditorForm, value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  return (
    <form className="editor" onSubmit={props.onSubmit}>
      <div className="detail-title-row">
        <div>
          <h2 className="workspace-title">编辑 Skill</h2>
          <p className="workspace-desc">字段会保存到本地 SQLite，安装命令只作为文本管理。</p>
        </div>
        <span className="status-badge">
          <Edit3 size={15} />
          本地条目
        </span>
      </div>

      <div className="form-grid">
        <Field label="名称" id="fieldName">
          <input id="fieldName" required value={props.form.name} onChange={(event) => props.onChange("name", event.target.value)} />
        </Field>
        <Field label="兼容平台" id="fieldPlatforms">
          <input id="fieldPlatforms" value={props.form.platforms} onChange={(event) => props.onChange("platforms", event.target.value)} />
        </Field>
        <Field label="简短介绍" id="fieldSummary" wide>
          <input id="fieldSummary" required value={props.form.summary} onChange={(event) => props.onChange("summary", event.target.value)} />
        </Field>
        <Field label="分类" id="fieldCategory" wide>
          <CategoryPicker
            id="fieldCategory"
            categories={props.categories}
            value={props.form.category}
            onChange={(value) => props.onChange("category", value)}
          />
        </Field>
        <Field label="适用场景" id="fieldScenario" wide>
          <textarea id="fieldScenario" value={props.form.scenario} onChange={(event) => props.onChange("scenario", event.target.value)} />
        </Field>
        <Field label="安装步骤" id="fieldSteps" wide>
          <textarea id="fieldSteps" value={props.form.installSteps} onChange={(event) => props.onChange("installSteps", event.target.value)} />
        </Field>
        <Field label="安装命令" id="fieldCommands" wide>
          <textarea id="fieldCommands" value={props.form.installCommands} onChange={(event) => props.onChange("installCommands", event.target.value)} />
        </Field>
        <Field label="来源链接" id="fieldSource" wide>
          <input id="fieldSource" value={props.form.sourceUrl} onChange={(event) => props.onChange("sourceUrl", event.target.value)} />
        </Field>
        <Field label="备注" id="fieldNotes" wide>
          <textarea id="fieldNotes" value={props.form.notes} onChange={(event) => props.onChange("notes", event.target.value)} />
        </Field>
      </div>

      <div className="editor-actions split">
        <div>{props.onDelete && <button type="button" className="danger-button" onClick={props.onDelete}><Trash2 size={15} />删除</button>}</div>
        <div className="action-cluster">
          <button type="button" className="secondary-button" onClick={props.onCancel}>取消</button>
          <button type="submit" className="primary-button"><Save size={15} />保存</button>
        </div>
      </div>
    </form>
  );
}

interface CategoryMenuRow {
  key: string;
  name: string;
  count?: number;
  kind: "create" | "option";
}

function CategoryPicker(props: {
  id: string;
  categories: CategoryOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = `${props.id}-menu`;
  const trimmedValue = props.value.trim();
  const createName = isNewCategory(props.categories, props.value) ? trimmedValue : "";
  const suggestions = useMemo(() => suggestCategories(props.categories, query), [props.categories, query]);
  const rows: CategoryMenuRow[] = [
    ...(createName ? [{ key: "create", name: createName, kind: "create" as const }] : []),
    ...suggestions.map((category) => ({ key: `category-${category.name}`, name: category.name, count: category.count, kind: "option" as const }))
  ];
  const activeRow = open && activeIndex >= 0 ? rows[activeIndex] : undefined;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openMenu(): void {
    setQuery("");
    setOpen(true);
  }

  function selectRow(row: CategoryMenuRow): void {
    props.onChange(row.name);
    setOpen(false);
    setActiveIndex(-1);
    setQuery("");
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openMenu();
        setActiveIndex(0);
        return;
      }
      setActiveIndex(rows.length === 0 ? -1 : (activeIndex + 1) % rows.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        setActiveIndex(-1);
        return;
      }
      setActiveIndex(rows.length === 0 || activeIndex <= 0 ? rows.length - 1 : activeIndex - 1);
      return;
    }

    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (activeRow) {
        selectRow(activeRow);
      } else {
        setOpen(false);
      }
      return;
    }

    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="category-picker" ref={rootRef}>
      <div className="category-input-row">
        <input
          id={props.id}
          role="combobox"
          aria-expanded={open}
          aria-controls={menuId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? `${props.id}-row-${activeIndex}` : undefined}
          autoComplete="off"
          placeholder="选择已有分类，或直接输入新分类"
          value={props.value}
          onChange={(event) => {
            props.onChange(event.target.value);
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onClick={openMenu}
          onFocus={openMenu}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="category-toggle"
          title={open ? "收起已有分类" : "展开已有分类"}
          aria-label={open ? "收起已有分类" : "展开已有分类"}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => {
            if (open) {
              setOpen(false);
            } else {
              openMenu();
            }
            setActiveIndex(-1);
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="category-menu" id={menuId} role="listbox" aria-label="已有分类">
          {rows.length === 0 ? (
            <p className="category-menu-empty">
              {props.categories.length === 0
                ? "还没有已有分类，直接输入名称就能新建"
                : createName
                  ? "没有匹配的分类，保存后会新建"
                  : "没有匹配的分类"}
            </p>
          ) : (
            rows.map((row, index) => (
              <div
                key={row.key}
                id={`${props.id}-row-${index}`}
                role="option"
                aria-selected={row.kind === "option" && row.name === trimmedValue}
                className={`category-option ${row.kind} ${index === activeIndex ? "active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectRow(row)}
              >
                {row.kind === "create" ? <Plus size={15} /> : <Folder size={15} />}
                <span className="category-option-name">
                  {row.kind === "create" ? `新建分类「${row.name}」` : row.name}
                </span>
                {typeof row.count === "number" && <span className="category-option-count">{row.count}</span>}
                {row.kind === "option" && row.name === trimmedValue && <Check size={14} />}
              </div>
            ))
          )}
          <p className="category-menu-hint">留空保存为未分类</p>
        </div>
      )}
    </div>
  );
}

function Field(props: { label: string; id: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`field ${props.wide ? "wide" : ""}`}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
    </div>
  );
}
