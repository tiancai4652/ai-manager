"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var reminders_exports = {};
__export(reminders_exports, {
  RemindersStore: () => RemindersStore
});
module.exports = __toCommonJS(reminders_exports);
var import_uuid = require("uuid");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
const DEFAULT_ENCODING = "utf-8";
function ensureFile(filePath) {
  const dir = (0, import_node_path.dirname)(filePath);
  if (!(0, import_node_fs.existsSync)(dir)) {
    (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  }
  if (!(0, import_node_fs.existsSync)(filePath)) {
    (0, import_node_fs.writeFileSync)(filePath, "[]", DEFAULT_ENCODING);
  }
}
function readReminders(filePath) {
  ensureFile(filePath);
  const raw = (0, import_node_fs.readFileSync)(filePath, DEFAULT_ENCODING);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Stored data is not an array \u2013 resetting to []");
    }
    return parsed;
  } catch (err) {
    const backup = filePath + ".bak";
    (0, import_node_fs.writeFileSync)(backup, raw, DEFAULT_ENCODING);
    console.warn(
      `[RemindersStore] Corrupted JSON detected. Backup saved to ${backup}. Resetting to empty array.`
    );
    (0, import_node_fs.writeFileSync)(filePath, "[]", DEFAULT_ENCODING);
    return [];
  }
}
function writeReminders(filePath, reminders) {
  ensureFile(filePath);
  const json = JSON.stringify(reminders, null, 2);
  (0, import_node_fs.writeFileSync)(filePath, json, DEFAULT_ENCODING);
}
function isValidRepeat(value) {
  return value === null || value === "daily" || value === "weekly" || value === "monthly" || value === "weekday";
}
class RemindersStore {
  constructor(filePath) {
    this.filePath = (0, import_node_path.resolve)(
      filePath ?? (0, import_node_path.resolve)(process.cwd(), "config", "reminders.json")
    );
  }
  // ---- CRUD operations ---------------------------------------------------
  /** Add a new reminder and persist. Returns the created reminder. */
  add(data) {
    const reminders = readReminders(this.filePath);
    const reminder = {
      id: data.id ?? (0, import_uuid.v4)(),
      title: String(data.title ?? ""),
      message: String(data.message ?? ""),
      time: data.time ?? (/* @__PURE__ */ new Date()).toISOString(),
      repeat: isValidRepeat(data.repeat) ? data.repeat : null,
      enabled: typeof data.enabled === "boolean" ? data.enabled : true
    };
    if (reminders.some((r) => r.id === reminder.id)) {
      reminder.id = (0, import_uuid.v4)();
    }
    reminders.push(reminder);
    writeReminders(this.filePath, reminders);
    return reminder;
  }
  /** Delete a reminder by id. Returns true if deleted, false if not found. */
  delete(id) {
    const reminders = readReminders(this.filePath);
    const index = reminders.findIndex((r) => r.id === id);
    if (index === -1) return false;
    reminders.splice(index, 1);
    writeReminders(this.filePath, reminders);
    return true;
  }
  /** Partially update a reminder. Returns the updated reminder or null. */
  update(id, patch) {
    const reminders = readReminders(this.filePath);
    const index = reminders.findIndex((r) => r.id === id);
    if (index === -1) return null;
    const existing = reminders[index];
    if (patch.title !== void 0) existing.title = String(patch.title);
    if (patch.message !== void 0) existing.message = String(patch.message);
    if (patch.time !== void 0) existing.time = String(patch.time);
    if (patch.repeat !== void 0) {
      existing.repeat = isValidRepeat(patch.repeat) ? patch.repeat : null;
    }
    if (patch.enabled !== void 0) {
      existing.enabled = Boolean(patch.enabled);
    }
    reminders[index] = existing;
    writeReminders(this.filePath, reminders);
    return existing;
  }
  /** Get all reminders. */
  getAll() {
    return readReminders(this.filePath);
  }
  /** Get a single reminder by id. Returns null if not found. */
  getById(id) {
    const reminders = readReminders(this.filePath);
    return reminders.find((r) => r.id === id) ?? null;
  }
  /** Get only enabled reminders. */
  getEnabled() {
    return readReminders(this.filePath).filter((r) => r.enabled);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RemindersStore
});
