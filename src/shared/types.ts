export type SkillSort = "updated" | "name" | "created";

export type SkillFilter = "all" | "recent" | "uncategorized" | string;

export interface SkillRecord {
  id: string;
  name: string;
  summary: string;
  category: string;
  tags: string[];
  scenario: string;
  installSteps: string[];
  installCommands: string[];
  sourceUrl: string;
  platforms: string[];
  notes: string;
  viewCount: number;
  lastViewedAt: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SkillInput = Omit<SkillRecord, "id" | "category" | "viewCount" | "lastViewedAt" | "favorite" | "createdAt" | "updatedAt"> & {
  category?: string;
};

export type SkillUpdate = Partial<SkillInput>;

export interface SkillListFilters {
  query: string;
  filter: SkillFilter;
  sort: SkillSort;
}

export type ImportConflictMode = "overwrite" | "skip" | "rename";

export interface ImportOptions {
  conflictMode: ImportConflictMode;
}

export interface ImportResult {
  created: number;
  overwritten: number;
  skipped: number;
  renamed: number;
}

export interface SkillExportPayload {
  version: 1;
  exportedAt: string;
  skills: SkillRecord[];
}

export type ModelProvider = "deepseek";

export interface ModelConfig {
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyPreview: string;
  updatedAt: string;
}

export interface ModelConfigInput {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ModelConnectionTestInput {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface ModelConnectionTestResult {
  ok: boolean;
  provider: ModelProvider;
  model: string;
  statusCode?: number;
  message: string;
  latencyMs: number;
  checkedAt: string;
}

export interface AiImportRequest {
  url: string;
  note: string;
  allowWebAccess: boolean;
}

export interface AiImportResult {
  sourceUrl: string;
  networkAccessRequested: boolean;
  modelStatus: "generated";
  preview: string;
  draft: SkillInput;
}
