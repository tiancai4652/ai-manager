"use strict";

const {
  app,
  BrowserWindow,
  ipcMain,
} = require("electron");
const path = require("node:path");

const { TrayManager } = require("./tray");
const { RemindersStore } = require("./data/reminders");
const { ReminderScheduler } = require("./scheduler");
const { Notifier } = require("./notifier");

// ---------------------------------------------------------------------------
// Single-instance lock — prevent duplicate processes
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {TrayManager | null} */
let trayManager = null;

/** @type {ReminderScheduler | null} */
let scheduler = null;

/** @type {Notifier | null} */
let notifier = null;

/** @type {RemindersStore | null} */
let store = null;

/**
 * Track whether the user intentionally chose to quit (via tray menu).
 * Without this, closing the window would always minimize to tray.
 */
let willQuit = false;

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

/**
 * Create the main application window.
 * @returns {BrowserWindow}
 */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 480,
    minHeight: 360,
    show: false, // Show when ready to avoid flash
    icon: path.resolve(__dirname, "..", "resources", "icon.png"),
    webPreferences: {
      preload: path.resolve(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the reminders management UI
  const remindersHtml = path.resolve(__dirname, "windows", "reminders.html");
  win.loadFile(remindersHtml).catch((err) => {
    console.error("[Main] Failed to load reminders.html:", err.message);
  });

  // Show window once the renderer is ready
  win.once("ready-to-show", () => {
    win.show();
  });

  // ---- Minimize to tray on close ----
  win.on("close", (event) => {
    if (!willQuit) {
      event.preventDefault();
      win.hide();
      console.log("[Main] Window hidden to tray (close intercepted).");
    }
    // If willQuit is true, the window closes normally → app quits
  });

  return win;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // --- Store ---
  store = new RemindersStore();

  // --- Notifier ---
  notifier = new Notifier();

  // --- Scheduler ---
  scheduler = new ReminderScheduler(store, (reminder) => {
    // When a reminder fires, show a system notification
    notifier
      .notify({
        title: reminder.title,
        message: reminder.message,
        sound: true,
      })
      .catch((err) => {
        console.error(
          `[Main] Notification error for "${reminder.title}":`,
          err.message
        );
      });

    // Also notify the renderer (if the window is visible)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("reminder:triggered", reminder);
    }
  });

  scheduler.start();

  // --- Main window ---
  mainWindow = createMainWindow();

  // --- Tray ---
  trayManager = new TrayManager(mainWindow);
  trayManager.init();

  // --- IPC handlers ---
  registerIpcHandlers();

  console.log("[Main] Application ready.");
});

// ---- Second-instance: focus existing window ----
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

// ---- macOS: re-create window when dock icon is clicked ----
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
    trayManager?.setMainWindow(mainWindow);
  }
});

// ---- Clean shutdown ----
app.on("before-quit", () => {
  willQuit = true;
  scheduler?.stop();
  trayManager?.destroy();
});

app.on("window-all-closed", () => {
  // On macOS, apps stay active until explicitly quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// IPC handlers — renderer ↔ main process communication
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  // ---- Reminders CRUD ----

  ipcMain.handle("reminders:getAll", () => {
    return store.getAll();
  });

  ipcMain.handle("reminders:getById", (_event, id) => {
    return store.getById(id);
  });

  ipcMain.handle("reminders:getEnabled", () => {
    return store.getEnabled();
  });

  ipcMain.handle("reminders:add", (_event, data) => {
    return store.add(data);
  });

  ipcMain.handle("reminders:update", (_event, id, patch) => {
    return store.update(id, patch);
  });

  ipcMain.handle("reminders:delete", (_event, id) => {
    return store.delete(id);
  });

  // ---- Window control ----

  ipcMain.handle("window:minimize", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle("window:close", () => {
    mainWindow?.close();
  });

  // ---- Tray control ----

  ipcMain.handle("tray:showWindow", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}
