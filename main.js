// Open World Apocalypse — desktop shell
// Saves live in %APPDATA%\Open World Apocalypse\saves, outside the install folder,
// so updates and reinstalls never touch them.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

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

/* ---------------- free local AI (Ollama) ---------------- */
const OLLAMA = "http://127.0.0.1:11434";
async function ofetch(p, opt = {}, ms = 4000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(OLLAMA + p, Object.assign({}, opt, { signal: c.signal })); } finally { clearTimeout(t); }
}
function ollamaExe() {
  const cands = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    path.join(process.env.ProgramFiles || "", "Ollama", "ollama.exe"),
  ];
  return cands.find((f) => { try { return f && fs.existsSync(f); } catch (e) { return false; } }) || null;
}
ipcMain.handle("ai-status", async (e, model) => {
  let running = false, hasModel = false;
  try {
    const r = await ofetch("/api/tags");
    if (r.ok) {
      running = true;
      const j = await r.json();
      hasModel = (j.models || []).some((m) => [m.name, m.model].some((x) => x && (x === model || x.startsWith(model))));
    }
  } catch (err) { /* not running */ }
  return { running, hasModel, installed: running || !!ollamaExe() };
});
ipcMain.handle("ai-start", async () => {
  const exe = ollamaExe(); if (!exe) return false;
  try { spawn(exe, ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref(); return true; } catch (err) { return false; }
});
ipcMain.handle("ai-install", async () => {
  if (process.platform !== "win32") { await shell.openExternal("https://ollama.com/download"); return "opened"; }
  const dest = path.join(app.getPath("temp"), "OllamaSetup.exe");
  const res = await fetch("https://ollama.com/download/OllamaSetup.exe", { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error("The installer download failed (" + res.status + "). Check your internet connection.");
  const total = +res.headers.get("content-length") || 0;
  let got = 0, last = 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
    const now = Date.now();
    if (now - last > 200) { last = now; send("ai-prog", { pct: total ? (got / total) * 100 : undefined, text: "Downloading installer… " + (total ? Math.round((got / total) * 100) + "%" : Math.round(got / 1048576) + " MB") }); }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  spawn(dest, [], { detached: true, stdio: "ignore" }).unref();
  return "launched";
});
ipcMain.handle("ai-pull", async (e, model) => {
  let res;
  try { res = await fetch(OLLAMA + "/api/pull", { method: "POST", body: JSON.stringify({ model, name: model, stream: true }) }); }
  catch (err) { throw new Error("Couldn't reach the local AI. Make sure Ollama is running, then try again."); }
  if (!res.ok || !res.body) throw new Error("The local AI refused the download (" + res.status + ").");
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let j; try { j = JSON.parse(line); } catch (err) { continue; }
      if (j.error) throw new Error(j.error);
      const pct = j.total ? (j.completed / j.total) * 100 : undefined, now = Date.now();
      if (now - last > 200 || j.status === "success") {
        last = now;
        send("ai-prog", { pct, text: j.status === "success" ? "Finishing…" : j.total ? "Downloading model… " + Math.round(pct) + "%" : (j.status || "Working…") });
      }
    }
  }
  return true;
});
ipcMain.handle("ai-chat", async (e, { prompt, json, model }) => {
  const body = { model, messages: [{ role: "user", content: String(prompt || "").slice(0, 60000) }], stream: false, options: { temperature: 0.85, num_predict: 420 } };
  if (json) body.format = "json";
  const res = await ofetch("/api/chat", { method: "POST", body: JSON.stringify(body) }, 120000);
  if (!res.ok) throw new Error("The local AI returned an error (" + res.status + ").");
  const j = await res.json();
  return (j.message && j.message.content) || "";
});

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
