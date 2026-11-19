import type {
  AiImportRequest,
  AiImportResult,
  ImportConflictMode,
  ImportResult,
  ModelConnectionTestInput,
  ModelConnectionTestResult,
  ModelConfig,
  ModelConfigInput,
  SkillInput,
  SkillListFilters,
  SkillRecord,
  SkillUpdate
} from "./types";

export interface JsonImportResponse {
  canceled: boolean;
  filePath?: string;
  result?: ImportResult;
}

export interface JsonExportResponse {
  canceled: boolean;
  filePath?: string;
}

export type SkillArchiveImportResponse =
  | { status: "canceled" }
  | { status: "imported"; skill: SkillRecord; fileName: string }
  | { status: "invalid"; message: string; fileName?: string };

export interface SkillRepositoryApi {
  listSkills(filters: SkillListFilters): Promise<SkillRecord[]>;
  getSkill(id: string): Promise<SkillRecord | undefined>;
  createSkill(input: SkillInput): Promise<SkillRecord>;
  importSkillArchive(): Promise<SkillArchiveImportResponse>;
  exportSkillArchive(id: string): Promise<JsonExportResponse>;
  updateSkill(id: string, patch: SkillUpdate): Promise<SkillRecord>;
  deleteSkill(id: string): Promise<boolean>;
  recordSkillView(id: string): Promise<SkillRecord>;
  toggleSkillFavorite(id: string): Promise<SkillRecord>;
  generateAiDraft(request: AiImportRequest): Promise<AiImportResult>;
  getModelConfig(): Promise<ModelConfig>;
  updateModelConfig(input: ModelConfigInput): Promise<ModelConfig>;
  revealModelApiKey(): Promise<string>;
  testModelConnection(input: ModelConnectionTestInput): Promise<ModelConnectionTestResult>;
  importJson(conflictMode: ImportConflictMode): Promise<JsonImportResponse>;
  exportJson(): Promise<JsonExportResponse>;
  openExternal(url: string): Promise<void>;
}

export const ipcChannels = {
  listSkills: "skills:list",
  getSkill: "skills:get",
  createSkill: "skills:create",
  importSkillArchive: "skills:import-archive",
  exportSkillArchive: "skills:export-archive",
  updateSkill: "skills:update",
  deleteSkill: "skills:delete",
  recordSkillView: "skills:record-view",
  toggleSkillFavorite: "skills:toggle-favorite",
  generateAiDraft: "ai:generate-draft",
  getModelConfig: "model-config:get",
  updateModelConfig: "model-config:update",
  revealModelApiKey: "model-config:reveal-key",
  testModelConnection: "model-config:test-connection",
  importJson: "json:import",
  exportJson: "json:export",
  openExternal: "app:open-external"
} as const;

export function hasModelConnectionApi(api: Partial<SkillRepositoryApi>): api is Partial<SkillRepositoryApi> & Pick<SkillRepositoryApi, "testModelConnection"> {
  return typeof api.testModelConnection === "function";
}
