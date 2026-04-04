const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    title: 'Acoustic Propagator',
    backgroundColor: '#0a0e17',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
  });

  // In dev, load Vite dev server; in prod, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── IPC handlers ───

ipcMain.handle('open-wav-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Spatial Audio WAV',
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const nodeBuffer = fs.readFileSync(filePath);
  // Convert to Uint8Array so it survives IPC structured clone reliably
  const uint8 = new Uint8Array(nodeBuffer);
  return {
    path: filePath,
    name: path.basename(filePath),
    buffer: uint8,
  };
});

ipcMain.handle('open-kmz-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load KMZ/KML File',
    filters: [{ name: 'KMZ/KML', extensions: ['kmz', 'kml'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    buffer: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ),
  };
});

ipcMain.handle('save-session', async (event, sessionData) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Session',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    defaultPath: 'acoustic-session.json',
  });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, JSON.stringify(sessionData, null, 2));
  return true;
});

ipcMain.handle('load-session', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Session',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
});

ipcMain.handle('save-config', async (event, config) => {
  const configPath = path.join(
    app.getPath('userData'),
    'propagator-config.json'
  );
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return true;
});

ipcMain.handle('load-config', async () => {
  const configPath = path.join(
    app.getPath('userData'),
    'propagator-config.json'
  );
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return null;
});

ipcMain.handle('save-screenshot', async (event, dataUrl) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Screenshot',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    defaultPath: `acoustic-propagator-${Date.now()}.png`,
  });
  if (result.canceled) return false;
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
  return result.filePath;
});
