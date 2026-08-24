#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const devServerUrl = "http://127.0.0.1:5173";
export const restartDebounceMs = 250;

const watchRoots = ["electron", "src/main", "src/shared"];
const sourceExtensions = new Set([".ts", ".mts", ".cts"]);
let electronProcess;
let restartTimer;
let restarting = false;
let queuedRestart = false;
const require = createRequire(import.meta.url);
const tscPath = path.resolve(path.dirname(require.resolve("typescript")), "../bin/tsc");

export function electronCommand() {
  const electronPath = require("electron");
  return typeof electronPath === "string" ? electronPath : process.platform === "win32" ? "electron.cmd" : "electron";
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isMainProcessSourceChange(filePath) {
  const normalized = normalizePath(filePath);
  const inWatchedRoot = watchRoots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
  return inWatchedRoot && sourceExtensions.has(path.extname(normalized));
}

export function createDevElectronEnv(env = process.env) {
  return {
    ...env,
    VITE_DEV_SERVER_URL: devServerUrl
  };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "inherit",
      ...options
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

function waitForExit(child, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

export async function waitForDevServer(url = devServerUrl, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

async function buildMain() {
  await run(process.execPath, [tscPath, "-p", "tsconfig.main.json"]);
}

function startElectron() {
  const child = spawn(electronCommand(), ["."], {
    cwd: process.cwd(),
    env: createDevElectronEnv(),
    stdio: "inherit"
  });
  electronProcess = child;

  child.on("exit", (code, signal) => {
    if (electronProcess === child) {
      electronProcess = undefined;
    }
    if (code && !restarting) {
      console.error(`[dev:electron] Electron exited with ${signal ?? code}`);
    }
  });
}

async function restartElectron(reason) {
  if (restarting) {
    queuedRestart = true;
    return;
  }

  restarting = true;
  console.log(`[dev:electron] ${reason}; rebuilding main process`);

  try {
    if (electronProcess) {
      electronProcess.kill();
      await waitForExit(electronProcess);
      electronProcess = undefined;
    }

    await buildMain();
    startElectron();
  } catch (error) {
    console.error(`[dev:electron] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    restarting = false;
    if (queuedRestart) {
      queuedRestart = false;
      scheduleRestart("queued source change");
    }
  }
}

function scheduleRestart(reason) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    void restartElectron(reason);
  }, restartDebounceMs);
}

function watchedDirectories(root) {
  const directories = [root];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      directories.push(...watchedDirectories(path.join(root, entry.name)));
    }
  }
  return directories;
}

function watchRoot(root) {
  if (!existsSync(root)) {
    return [];
  }

  try {
    const watcher = watch(root, { recursive: true }, (_event, fileName) => {
      if (fileName) {
        const changedPath = normalizePath(path.join(root, fileName.toString()));
        if (isMainProcessSourceChange(changedPath)) {
          scheduleRestart(changedPath);
        }
      }
    });
    return [watcher];
  } catch {
    return watchedDirectories(root)
      .filter((directory) => statSync(directory).isDirectory())
      .map((directory) => watch(directory, (_event, fileName) => {
        if (fileName) {
          const changedPath = normalizePath(path.join(directory, fileName.toString()));
          if (isMainProcessSourceChange(changedPath)) {
            scheduleRestart(changedPath);
          }
        }
      }));
  }
}

async function main() {
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify({ devServerUrl, restartDebounceMs, watchRoots }));
    return;
  }

  console.log(`[dev:electron] waiting for Vite at ${devServerUrl}`);
  await waitForDevServer();
  await restartElectron("initial start");

  const watchers = watchRoots.flatMap(watchRoot);
  console.log(`[dev:electron] watching ${watchRoots.join(", ")}`);

  const shutdown = async () => {
    clearTimeout(restartTimer);
    watchers.forEach((watcher) => watcher.close());
    if (electronProcess) {
      electronProcess.kill();
      await waitForExit(electronProcess);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[dev:electron] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
