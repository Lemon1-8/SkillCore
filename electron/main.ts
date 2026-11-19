import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import { ipcChannels } from "../src/shared/api";
import { createSkillStore, type SkillStore } from "../src/main/skill-store";
import { maxArchiveBytes } from "../src/main/skill-archive";
import type { SkillArchiveImportResponse } from "../src/shared/api";
import type {
  AiImportRequest,
  ImportConflictMode,
  ModelConfigInput,
  ModelConnectionTestInput,
  SkillInput,
  SkillListFilters,
  SkillUpdate
} from "../src/shared/types";

let mainWindow: BrowserWindow | undefined;
let store: SkillStore | undefined;

interface RendererReadyState {
  hasShell: boolean;
  hasAiImportText: boolean;
  bodyText: string;
  bodyInnerText: string;
}

function getStore(): SkillStore {
  if (!store) {
    throw new Error("Skill 数据库尚未初始化");
  }

  return store;
}

function windowIcon() {
  const packagedIconPath = path.join(process.resourcesPath, "app-icon.png");
  const iconPath = app.isPackaged && existsSync(packagedIconPath)
    ? packagedIconPath
    : path.join(process.cwd(), "build", "app-icon.png");

  return existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;
}

async function waitForRendererReady(window: BrowserWindow, timeoutMs = 5000): Promise<RendererReadyState> {
  const startedAt = Date.now();
  let lastState: RendererReadyState | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = (await window.webContents.executeJavaScript(`(() => {
      const text = document.body.textContent || "";
      const innerText = document.body.innerText || "";
      return {
        hasShell: Boolean(document.querySelector(".app-shell")),
        hasAiImportText: text.includes("AI 导入"),
        bodyText: text.slice(0, 160),
        bodyInnerText: innerText.slice(0, 160)
      };
    })()`)) as RendererReadyState;

    if (lastState.hasShell && lastState.hasAiImportText) {
      return lastState;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`renderer-not-ready ${JSON.stringify(lastState)}`);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    show: process.env.SKILL_REPO_SMOKE !== "1",
    title: "个人 Skill 仓库",
    icon: windowIcon(),
    backgroundColor: "#f4f5f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  if (process.env.SKILL_REPO_SMOKE === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      void waitForRendererReady(mainWindow as BrowserWindow)
        .then(() => {
          console.log("skill-repository-gui:smoke-ready");
          app.quit();
        })
        .catch((error: unknown) => {
          console.error(error);
          app.exit(1);
        });
    });
    mainWindow.webContents.once("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error(`skill-repository-gui:smoke-failed ${errorCode} ${errorDescription}`);
      app.exit(1);
    });
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.listSkills, (_event, filters: SkillListFilters) => getStore().list(filters));
  ipcMain.handle(ipcChannels.getSkill, (_event, id: string) => getStore().get(id));
  ipcMain.handle(ipcChannels.createSkill, (_event, input: SkillInput) => getStore().create(input));
  ipcMain.handle(ipcChannels.importSkillArchive, async (): Promise<SkillArchiveImportResponse> => {
    let fileName: string | undefined;
    try {
      const options: OpenDialogOptions = {
        title: "导入 Skill ZIP",
        properties: ["openFile"],
        filters: [{ name: "Skill ZIP 压缩包", extensions: ["zip"] }]
      };
      const selection = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      if (selection.canceled || !selection.filePaths.length) return { status: "canceled" };
      const filePath = selection.filePaths[0];
      fileName = path.basename(filePath);
      if (path.extname(filePath).toLowerCase() !== ".zip") {
        return { status: "invalid", fileName, message: "请选择 .zip 格式的 Skill 压缩包。" };
      }
      const file = await open(filePath, "r");
      let data: Buffer;
      try {
        if ((await file.stat()).size > maxArchiveBytes) {
          return { status: "invalid", fileName, message: "ZIP 文件不能超过 20 MB。" };
        }
        // Read at most one byte over the limit, even if the file changes after stat.
        const chunks: Buffer[] = [];
        for await (const chunk of file.createReadStream({ end: maxArchiveBytes, autoClose: false })) {
          chunks.push(chunk as Buffer);
        }
        data = Buffer.concat(chunks);
      } finally {
        await file.close();
      }
      const skill = await getStore().importSkillArchive(data, fileName);
      return { status: "imported", fileName, skill };
    } catch (error) {
      return { status: "invalid", fileName, message: error instanceof Error ? error.message : "导入 ZIP 失败，请重新选择文件。" };
    }
  });
  ipcMain.handle(ipcChannels.exportSkillArchive, async (_event, id: string) => {
    const archive = getStore().getArchive(id);
    if (!archive) throw new Error("此 Skill 没有保存原始 ZIP。");
    const options: SaveDialogOptions = {
      title: "导出原始 Skill ZIP",
      defaultPath: archive.fileName,
      filters: [{ name: "ZIP", extensions: ["zip"] }]
    };
    const selection = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { canceled: true };
    await writeFile(selection.filePath, archive.data);
    return { canceled: false, filePath: selection.filePath };
  });
  ipcMain.handle(ipcChannels.updateSkill, (_event, id: string, patch: SkillUpdate) => getStore().update(id, patch));
  ipcMain.handle(ipcChannels.deleteSkill, (_event, id: string) => getStore().remove(id));
  ipcMain.handle(ipcChannels.recordSkillView, (_event, id: string) => getStore().recordView(id));
  ipcMain.handle(ipcChannels.toggleSkillFavorite, (_event, id: string) => getStore().toggleFavorite(id));
  ipcMain.handle(ipcChannels.generateAiDraft, (_event, request: AiImportRequest) => getStore().generateAiDraft(request));
  ipcMain.handle(ipcChannels.getModelConfig, () => getStore().getModelConfig());
  ipcMain.handle(ipcChannels.updateModelConfig, (_event, input: ModelConfigInput) => getStore().updateModelConfig(input));
  ipcMain.handle(ipcChannels.revealModelApiKey, () => getStore().revealModelApiKey());
  ipcMain.handle(ipcChannels.testModelConnection, (_event, input: ModelConnectionTestInput) => getStore().testModelConnection(input));

  ipcMain.handle(ipcChannels.importJson, async (_event, conflictMode: ImportConflictMode) => {
    const parent = mainWindow;
    const options: OpenDialogOptions = { properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] };
    const selection = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);

    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = selection.filePaths[0];
    const payload = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    const result = getStore().importJson(payload, { conflictMode });
    return { canceled: false, filePath, result };
  });

  ipcMain.handle(ipcChannels.exportJson, async () => {
    const parent = mainWindow;
    const options: SaveDialogOptions = { filters: [{ name: "JSON", extensions: ["json"] }] };
    const selection = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);

    if (selection.canceled || !selection.filePath) {
      return { canceled: true };
    }

    writeFileSync(selection.filePath, JSON.stringify(getStore().exportJson(), null, 2), "utf8");
    return { canceled: false, filePath: selection.filePath };
  });

  ipcMain.handle(ipcChannels.openExternal, async (_event, url: string) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("仅支持打开 http/https 来源链接");
    }

    await shell.openExternal(parsed.toString());
  });
}

app.whenReady().then(() => {
  store = createSkillStore(path.join(app.getPath("userData"), "skills.sqlite"));
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  store?.close();
});
