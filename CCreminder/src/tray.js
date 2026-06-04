"use strict";

const {
  Tray,
  Menu,
  nativeImage,
  app,
} = require("electron");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default tray icon — 16×16 is the standard Windows tray size. */
const DEFAULT_ICON_PATH = path.resolve(
  __dirname, "..", "resources", "tray-icon.png"
);

/**
 * Fallback: generate a minimal 16×16 blue circle as a data-URL so the tray
 * still works even when no icon file is present.
 */
const FALLBACK_ICON_DATA =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhki" +
  "AAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3LmVwcy5jb20" +
  "ubmV0AAAAowEBBSHvc3oAAAB1SURBVDiN7dIxCgAgDAPA2P9/2g5CBQViF82ULJfI" +
  "SLiOgXmghBCyLc/z3u7L5fwB2Kfq+g6A9N0ciEAA93EcxwDAr6SUfN9/rv8A+IZhG" +
  "IZxHP8nDMM4ixxI0zRcu1BKoTACz/OPpwAAAABJRU5ErkJggg==";

// ---------------------------------------------------------------------------
// TrayManager
// ---------------------------------------------------------------------------

/**
 * 系统托盘管理器。
 *
 * 职责：
 *   - 创建并管理系统托盘图标
 *   - 右键菜单：查看所有提醒 / 添加新提醒 / 退出应用
 *   - 左键点击：切换主窗口显示/隐藏
 *   - 提供销毁方法供 app quit 时清理
 *
 * @example
 *   const tray = new TrayManager(mainWindow);
 *   tray.init();
 *   // ...
 *   tray.destroy();
 */
class TrayManager {
  /** @type {import("electron").BrowserWindow | null} */
  #mainWindow;

  /** @type {Tray | null} */
  #tray = null;

  /** @type {string} */
  #iconPath;

  /**
   * @param {import("electron").BrowserWindow} mainWindow
   * @param {object}  [options]
   * @param {string}  [options.iconPath]  托盘图标路径（缺省使用 resources/tray-icon.png）
   */
  constructor(mainWindow, options = {}) {
    if (!mainWindow) {
      throw new TypeError("[TrayManager] a BrowserWindow instance is required");
    }
    this.#mainWindow = mainWindow;
    this.#iconPath = options.iconPath || DEFAULT_ICON_PATH;
  }

  // ---- Public API --------------------------------------------------------

  /**
   * 初始化系统托盘：设置图标、工具提示、菜单、点击事件。
   * 必须在 app.on("ready") 之后调用。
   */
  init() {
    if (this.#tray) {
      console.warn("[TrayManager] Already initialized — call destroy() first.");
      return;
    }

    const icon = this.#loadIcon();
    this.#tray = new Tray(icon);

    this.#tray.setToolTip("CCReminder — 提醒助手");

    // Right-click context menu
    this.#tray.setContextMenu(this.#buildMenu());

    // Left-click: toggle window visibility
    this.#tray.on("click", () => this.#toggleWindow());

    // Rebuild menu when window reference might change (e.g. after recreation)
    this.#tray.on("right-click", () => {
      this.#tray?.setContextMenu(this.#buildMenu());
    });

    console.log("[TrayManager] Tray icon initialized.");
  }

  /**
   * 更新托盘持有的主窗口引用。
   * 当主窗口被重建时调用。
   *
   * @param {import("electron").BrowserWindow} mainWindow
   */
  setMainWindow(mainWindow) {
    this.#mainWindow = mainWindow;
  }

  /**
   * 销毁托盘图标并清理资源。
   */
  destroy() {
    if (!this.#tray) return;
    this.#tray.destroy();
    this.#tray = null;
    console.log("[TrayManager] Tray destroyed.");
  }

  /**
   * 托盘是否已初始化。
   */
  get initialized() {
    return this.#tray !== null;
  }

  // ---- Internal ----------------------------------------------------------

  /**
   * Build the right-click context menu.
   * @returns {import("electron").Menu}
   */
  #buildMenu() {
    return Menu.buildFromTemplate([
      {
        label: "📋 查看所有提醒",
        type: "normal",
        click: () => this.#showWindow("reminders"),
      },
      {
        label: "➕ 添加新提醒",
        type: "normal",
        click: () => this.#showWindow("add"),
      },
      { type: "separator" },
      {
        label: "❌ 退出应用",
        type: "normal",
        click: () => this.#quitApp(),
      },
    ]);
  }

  /**
   * Show and focus the main window, optionally navigating to a view.
   *
   * @param {"reminders" | "add"} [view]
   */
  #showWindow(view) {
    const win = this.#mainWindow;
    if (!win || win.isDestroyed()) return;

    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();

    win.focus();

    // Send navigation event to the renderer process
    if (view) {
      win.webContents.send("navigate", view);
    }
  }

  /**
   * Toggle main window visibility on tray click.
   */
  #toggleWindow() {
    const win = this.#mainWindow;
    if (!win || win.isDestroyed()) return;

    if (win.isVisible() && !win.isMinimized()) {
      win.hide();
    } else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  }

  /**
   * Quit the entire application cleanly.
   */
  #quitApp() {
    // Destroy tray first to prevent ghost icons
    this.destroy();
    app.quit();
  }

  /**
   * Load the tray icon as a nativeImage.
   * Falls back to a built-in data URL if the icon file is missing.
   *
   * @returns {import("electron").NativeImage}
   */
  #loadIcon() {
    const fs = require("node:fs");
    if (fs.existsSync(this.#iconPath)) {
      const image = nativeImage.createFromPath(this.#iconPath);
      if (!image.isEmpty()) {
        return image.resize({ width: 16, height: 16 });
      }
      console.warn(
        `[TrayManager] Icon file exists but produced empty image: ${this.#iconPath}`
      );
    }

    console.warn(
      `[TrayManager] Tray icon not found at ${this.#iconPath}, using fallback.`
    );
    return nativeImage.createFromDataURL(FALLBACK_ICON_DATA);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { TrayManager, DEFAULT_ICON_PATH };
