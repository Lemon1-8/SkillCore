import type { SkillRepositoryApi } from "../shared/api";

declare global {
  interface Window {
    skillRepo: SkillRepositoryApi;
  }
}

export {};
