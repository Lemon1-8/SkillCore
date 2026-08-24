import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface WatchModule {
  restartDebounceMs: number;
  createDevElectronEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  electronCommand(): string;
  isMainProcessSourceChange(filePath: string): boolean;
}

async function loadWatchModule(): Promise<WatchModule> {
  const moduleUrl = pathToFileURL(path.resolve("scripts/dev-electron-watch.mjs")).href;
  return import(moduleUrl) as Promise<WatchModule>;
}

describe("dev Electron watcher", () => {
  it("restarts Electron for main, preload, and shared source changes only", async () => {
    const { isMainProcessSourceChange } = await loadWatchModule();

    expect(isMainProcessSourceChange("electron/main.ts")).toBe(true);
    expect(isMainProcessSourceChange("electron/preload.ts")).toBe(true);
    expect(isMainProcessSourceChange("src/main/skill-store.ts")).toBe(true);
    expect(isMainProcessSourceChange("src/shared/api.ts")).toBe(true);
    expect(isMainProcessSourceChange("src/renderer/App.tsx")).toBe(false);
    expect(isMainProcessSourceChange("dist/main/electron/main.js")).toBe(false);
  });

  it("injects the Vite dev server URL for Electron", async () => {
    const { createDevElectronEnv, restartDebounceMs } = await loadWatchModule();

    expect(createDevElectronEnv({ FOO: "bar" })).toMatchObject({
      FOO: "bar",
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5173"
    });
    expect(restartDebounceMs).toBeGreaterThanOrEqual(100);
  });

  it("starts Electron through the installed executable", async () => {
    const { electronCommand } = await loadWatchModule();

    expect(electronCommand()).toContain(path.join("node_modules", "electron"));
  });
});
