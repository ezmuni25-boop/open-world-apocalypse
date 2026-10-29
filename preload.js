// Exposes a small, safe API to the game page as window.owaDesktop
const { contextBridge, ipcRenderer } = require("electron");

const clean = (p) => p.catch((err) => {
  const m = String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  throw new Error(m);
});

contextBridge.exposeInMainWorld("owaDesktop", {
  version: ipcRenderer.sendSync("app-version"),
  store: {
    get: (k) => ipcRenderer.sendSync("store-get", k),
    set: (k, v) => ipcRenderer.sendSync("store-set", k, v),
    del: (k) => ipcRenderer.sendSync("store-del", k),
  },
  update: {
    check: () => clean(ipcRenderer.invoke("upd-check")),
    download: () => clean(ipcRenderer.invoke("upd-download")),
    install: () => ipcRenderer.invoke("upd-install"),
    onStatus: (cb) => { ipcRenderer.on("upd", (e, d) => cb(d)); },
  },
  files: {
    save: (text, name) => ipcRenderer.invoke("file-save", { text, name }),
    open: () => ipcRenderer.invoke("file-open"),
  },
});
