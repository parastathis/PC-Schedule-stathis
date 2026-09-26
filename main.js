/*
  PC Schedule as its own desktop app.

  The page is still index.html. Electron gives it its own window and taskbar
  icon, and a real file on disk to keep the goals in:
      data/schedule.json          – the live save, written on every change
      data/backups/YYYY-MM-DD.json – one copy per day, the last 30 kept
      data/backups/monthly/YYYY-MM.json, data/backups/yearly/YYYY.json – kept forever

  The packaged exe (dist/PC Schedule-win32-x64) loads index.html from this
  folder, two levels up, so edits to the page need no rebuild.
*/
const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require("electron");
const fs = require("fs");
const path = require("path");

app.setAppUserModelId("gr.stathis.pcschedule");

function sourceDir() {
  if (!app.isPackaged) return __dirname;
  const outer = path.resolve(path.dirname(process.execPath), "..", "..");
  return fs.existsSync(path.join(outer, "index.html")) ? outer : __dirname;
}
const SRC = sourceDir();
// A packaged exe that lost its source folder keeps its data in the user profile instead.
const DATA_DIR = app.isPackaged && SRC === __dirname
  ? path.join(app.getPath("userData"), "data")
  : path.join(SRC, "data");
const DATA_FILE = path.join(DATA_DIR, "schedule.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BOUNDS_FILE = path.join(DATA_DIR, "window.json");
const MONTHLY_DIR = path.join(BACKUP_DIR, "monthly");
const YEARLY_DIR = path.join(BACKUP_DIR, "yearly");
const KEEP_BACKUPS = 30;

for (const dir of [BACKUP_DIR, MONTHLY_DIR, YEARLY_DIR]) fs.mkdirSync(dir, { recursive: true });

function today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* Write to a temp file and rename it over the real one, so a crash
   mid-write can never leave a half-written save behind. */
function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

/* First run: no save file yet, so pick up the newest "Export backup" file
   from Downloads — that is how the goals move over from the Edge version. */
function newestExport() {
  const dir = app.getPath("downloads");
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^schedule-backup-.*\.json$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files) {
      const obj = readJSON(path.join(dir, f));
      if (obj && typeof obj === "object") return { obj, name: f };
    }
  } catch (e) {}
  return null;
}

ipcMain.on("store:read", (e) => {
  try { e.returnValue = fs.readFileSync(DATA_FILE, "utf8"); return; } catch (err) {}
  const found = newestExport();
  if (found) {
    delete found.obj.exportedAt;
    found.obj.__importedFrom = found.name;
    e.returnValue = JSON.stringify(found.obj);
  } else {
    e.returnValue = null;
  }
});

ipcMain.on("store:write", (e, json) => {
  try {
    JSON.parse(json);                       // never write something unreadable
    writeAtomic(DATA_FILE, json);
    const daily = path.join(BACKUP_DIR, today() + ".json");
    if (!fs.existsSync(daily)) {
      fs.writeFileSync(daily, json, "utf8");
      const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      while (old.length > KEEP_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
    }
    // One copy per month and one per year, kept forever: the latest save of
    // that month/year, so each file is how things stood when it closed.
    writeAtomic(path.join(MONTHLY_DIR, today().slice(0, 7) + ".json"), json);
    writeAtomic(path.join(YEARLY_DIR, today().slice(0, 4) + ".json"), json);
  } catch (err) {
    console.error("save failed:", err);
  }
});

ipcMain.on("store:open-folder", () => { shell.openPath(DATA_DIR); });

let win = null;

function createWindow() {
  nativeTheme.themeSource = "dark";
  const saved = readJSON(BOUNDS_FILE) || {};
  win = new BrowserWindow({
    width: saved.width || 1440,
    height: saved.height || 920,
    x: saved.x, y: saved.y,
    minWidth: 380,
    minHeight: 500,
    title: "PC Schedule",
    icon: path.join(SRC, "icon.ico"),
    backgroundColor: "#0b0b0d",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  if (saved.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  const remember = () => {
    if (!win || win.isMinimized()) return;
    const b = win.getNormalBounds();
    try { writeAtomic(BOUNDS_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch (e) {}
  };
  win.on("close", remember);

  // links never open inside the planner window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(path.join(SRC, "index.html"));
  win.on("closed", () => { win = null; });
}

// One planner at a time: a second launch just brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
