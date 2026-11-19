const { app } = require("electron");
const path = require("node:path");

// Keep integration tests isolated from the user's real database and windows.
app.setPath("userData", process.env.SKILL_REPO_TEST_USER_DATA);
app.disableHardwareAcceleration();
app.on("browser-window-created", (_event, window) => window.hide());
require(path.join(__dirname, "../dist/main/electron/main.js"));
