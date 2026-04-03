const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    title: "Acoustic Propagator",
    backgroundColor: "#0a0e17",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    // Frameless for immersive feel — comment out if you want standard chrome
    // frame: false,
    titleBarStyle: "hiddenInset",
  });

  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC handlers ───

// File open dialog for WAV files
ipcMain.handle("open-wav-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Load Spatial Audio WAV",
    filters: [{ name: "WAV Audio", extensions: ["wav"] }],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
});

// Save/load config
ipcMain.handle("save-config", async (event, config) => {
  const configPath = path.join(app.getPath("userData"), "propagator-config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return true;
});

ipcMain.handle("load-config", async () => {
  const configPath = path.join(app.getPath("userData"), "propagator-config.json");
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }
  return null;
});
