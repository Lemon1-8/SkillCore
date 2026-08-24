import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels, type SkillRepositoryApi } from "../src/shared/api";
import type {
  AiImportRequest,
  ImportConflictMode,
  ModelConfigInput,
  ModelConnectionTestInput,
  SkillInput,
  SkillListFilters,
  SkillUpdate
} from "../src/shared/types";

const api: SkillRepositoryApi = {
  listSkills(filters: SkillListFilters) {
    return ipcRenderer.invoke(ipcChannels.listSkills, filters);
  },

  getSkill(id: string) {
    return ipcRenderer.invoke(ipcChannels.getSkill, id);
  },

  createSkill(input: SkillInput) {
    return ipcRenderer.invoke(ipcChannels.createSkill, input);
  },

  updateSkill(id: string, patch: SkillUpdate) {
    return ipcRenderer.invoke(ipcChannels.updateSkill, id, patch);
  },

  deleteSkill(id: string) {
    return ipcRenderer.invoke(ipcChannels.deleteSkill, id);
  },

  recordSkillView(id: string) {
    return ipcRenderer.invoke(ipcChannels.recordSkillView, id);
  },

  toggleSkillFavorite(id: string) {
    return ipcRenderer.invoke(ipcChannels.toggleSkillFavorite, id);
  },

  generateAiDraft(request: AiImportRequest) {
    return ipcRenderer.invoke(ipcChannels.generateAiDraft, request);
  },

  getModelConfig() {
    return ipcRenderer.invoke(ipcChannels.getModelConfig);
  },

  updateModelConfig(input: ModelConfigInput) {
    return ipcRenderer.invoke(ipcChannels.updateModelConfig, input);
  },

  testModelConnection(input: ModelConnectionTestInput) {
    return ipcRenderer.invoke(ipcChannels.testModelConnection, input);
  },

  importJson(conflictMode: ImportConflictMode) {
    return ipcRenderer.invoke(ipcChannels.importJson, conflictMode);
  },

  exportJson() {
    return ipcRenderer.invoke(ipcChannels.exportJson);
  },

  openExternal(url: string) {
    return ipcRenderer.invoke(ipcChannels.openExternal, url);
  }
};

contextBridge.exposeInMainWorld("skillRepo", api);
