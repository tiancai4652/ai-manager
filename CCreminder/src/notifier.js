"use strict";

const notifier = require("node-notifier");
const path = require("node:path");
const fs = require("node:fs");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ICON = path.resolve(
  __dirname, "..", "resources", "icon.png"
);

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

/**
 * Windows 系统通知管理器。
 *
 * 封装 node-notifier，提供一致的发送接口、点击回调、错误处理。
 * 典型用法：
 *   const { notify } = require("./src/notifier");
 *   notify({ title: "提醒", message: "该喝水了" });
 */
class Notifier {
  /** @type {Set<(title: string, message: string) => void>} */
  #clickListeners = new Set();

  /** @type {string | undefined} */
  #icon;

  /**
   * @param {object}  [options]
   * @param {string}  [options.icon]  默认图标路径（缺省使用 resources/icon.png）
   */
  constructor(options = {}) {
    // Resolve icon — use provided, fallback to default, accept missing
    if (options.icon) {
      this.#icon = path.resolve(options.icon);
    } else if (fs.existsSync(DEFAULT_ICON)) {
      this.#icon = DEFAULT_ICON;
    }
    // If neither exists, icon stays undefined — notification shows without icon
  }

  // ---- Public API --------------------------------------------------------

  /**
   * 发送一条 Windows 系统通知。
   *
   * @param {object}          params
   * @param {string}          params.title   通知标题
   * @param {string}          params.message 通知正文
   * @param {string}          [params.icon]  本次通知专用的图标路径（覆盖默认）
   * @param {string}          [params.sound] 提示音（默认 "true"，传 false 静音）
   * @param {number}          [params.wait]  是否等待用户操作（默认 5 秒自动消失）
   * @returns {Promise<void>} 通知发送成功 resolve，失败 reject
   */
  notify({ title, message, icon, sound, wait }) {
    return new Promise((resolve, reject) => {
      if (!title || typeof title !== "string") {
        return reject(new Error("[Notifier] title is required and must be a string"));
      }
      if (!message || typeof message !== "string") {
        return reject(new Error("[Notifier] message is required and must be a string"));
      }

      const notifyOpts = {
        title,
        message,
        sound: sound !== false ? true : false,
        wait: wait ?? false,
        // Use per-call icon > constructor icon > none
        ...(this.#resolveIcon(icon)),
      };

      notifier.notify(notifyOpts, (err, response, metadata) => {
        if (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[Notifier] Failed to send notification "${title}": ${errMsg}`
          );
          return reject(
            new Error(`Notification failed: ${errMsg}`)
          );
        }

        // response values: "activated" | "timedOut" | "clicked" (platform-dependent)
        if (response === "activated" || response === "clicked") {
          for (const listener of this.#clickListeners) {
            try {
              listener(title, message);
            } catch (cbErr) {
              console.error(
                `[Notifier] Click listener error:`,
                cbErr instanceof Error ? cbErr.message : cbErr
              );
            }
          }
        }

        resolve();
      });
    });
  }

  /**
   * 注册通知点击回调。返回取消注册的函数。
   *
   * @param {(title: string, message: string) => void} listener
   * @returns {() => void} 调用即可取消注册
   */
  onClick(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("[Notifier] onClick listener must be a function");
    }
    this.#clickListeners.add(listener);
    // Return unsubscribe function
    return () => this.#clickListeners.delete(listener);
  }

  /**
   * 移除所有点击监听器。
   */
  removeAllListeners() {
    this.#clickListeners.clear();
  }

  // ---- Internal ----------------------------------------------------------

  /**
   * Resolve icon path — validates existence and returns the appropriate
   * property for node-notifier options.
   * @param {string} [override]
   * @returns {{ appID?: string, icon?: string } | {}}
   */
  #resolveIcon(override) {
    const iconPath = override
      ? path.resolve(override)
      : this.#icon;

    if (!iconPath) return {};

    if (!fs.existsSync(iconPath)) {
      console.warn(
        `[Notifier] Icon not found: ${iconPath} — sending without icon.`
      );
      return {};
    }

    return { icon: iconPath };
  }
}

// ---------------------------------------------------------------------------
// Convenience singleton + shorthand
// ---------------------------------------------------------------------------

/** Shared instance with default settings */
const defaultNotifier = new Notifier();

/**
 * 快捷发送通知（使用默认 Notifier 实例）。
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.message
 * @param {string} [params.icon]
 */
function notify(params) {
  return defaultNotifier.notify(params);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  Notifier,
  notify,
  defaultNotifier,
};
