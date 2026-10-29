// Open World Apocalypse — desktop shell
// Saves live in %APPDATA%\Open World Apocalypse\saves, outside the install folder,
// so updates and reinstalls never touch them.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { autoUpdater = null; }

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const cleanErr = (e) => String((e && e.message) || e || "Unknown error").split("\n")[0].slice(0, 160);

/* ---------------- saves ---------------- */
const saveDir = () => path.join(app.getPath("userData"), "saves");
const keyFile = (k) => path.join(saveDir(), String(k).replace(/[^a-z0-9._-]/gi, "_") + ".json");
function readKey(k) {
  for (const f of [keyFile(k), keyFile(k) + ".bak"]) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { /* try the backup next */ }
  }
  return null;
}
function writeKey(k, v) {
  fs.mkdirSync(saveDir(), { recursive: true });
  const f = keyFile(k), tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(v));
  if (fs.existsSync(f)) { try { fs.copyFileSync(f, f + ".bak"); } catch (e) { /* backup is best-effort */ } }
  fs.renameSync(tmp, f);
  return true;
}
ipcMain.on("app-version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.on("store-get", (e, k) => { e.returnValue = readKey(k); });
ipcMain.on("store-set", (e, k, v) => { try { e.returnValue = writeKey(k, v); } catch (err) { e.returnValue = false; } });
ipcMain.on("store-del", (e, k) => { try { fs.rmSync(keyFile(k), { force: true }); } catch (err) { /* already gone */ } e.returnValue = true; });

ipcMain.handle("file-save", async (e, { text, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("documents"), name || "save.txt"), filters: [{ name: "Save code", extensions: ["txt"] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, String(text || ""));
  return true;
});
ipcMain.handle("file-open", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Save code", extensions: ["txt"] }, { name: "All files", extensions: ["*"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return fs.readFileSync(r.filePaths[0], "utf8").slice(0, 5e6);
});

/* ---------------- updates (GitHub Releases) ---------------- */
let updInfo = null;
function setupUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => send("upd", { state: "checking" }));
  autoUpdater.on("update-available", (i) => { updInfo = i; send("upd", { state: "available", version: i.version }); });
  autoUpdater.on("update-not-available", () => send("upd", { state: "none" }));
  autoUpdater.on("download-progress", (p) => send("upd", { state: "downloading", version: updInfo && updInfo.version, pct: p.percent }));
  autoUpdater.on("update-downloaded", (i) => send("upd", { state: "ready", version: i.version }));
  autoUpdater.on("error", (err) => send("upd", { state: "error", msg: cleanErr(err) }));
}
ipcMain.handle("upd-check", async () => {
  if (!app.isPackaged || !autoUpdater) { send("upd", { state: "dev", msg: "Updates only work in the installed game." }); return; }
  try { await autoUpdater.checkForUpdates(); } catch (err) { send("upd", { state: "error", msg: cleanErr(err) }); }
});
ipcMain.handle("upd-download", async () => {
  if (!autoUpdater) return;
  try { await autoUpdater.downloadUpdate(); } catch (err) { send("upd", { state: "error", msg: cleanErr(err) }); }
});
ipcMain.handle("upd-install", () => { if (autoUpdater) autoUpdater.quitAndInstall(true, true); });


/* ---------------- window ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    backgroundColor: "#0b0c0a", title: "Open World Apocalypse", autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "game", "index.html"));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "F11") { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.on("closed", () => { win = null; });
}
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { setupUpdater(); createWindow(); });
app.on("window-all-closed", () => app.quit());
