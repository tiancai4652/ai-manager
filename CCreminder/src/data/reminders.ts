import { v4 as uuidv4 } from "uuid";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepeatMode = "daily" | "weekly" | "monthly" | "weekday" | null;

export interface Reminder {
  id: string;
  title: string;
  message: string;
  time: string; // ISO 8601 string
  repeat: RepeatMode;
  enabled: boolean;
}

export type ReminderPatch = Partial<Omit<Reminder, "id">>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_ENCODING: BufferEncoding = "utf-8";

function ensureFile(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "[]", DEFAULT_ENCODING);
  }
}

function readReminders(filePath: string): Reminder[] {
  ensureFile(filePath);
  const raw = readFileSync(filePath, DEFAULT_ENCODING);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Stored data is not an array – resetting to []");
    }
    return parsed as Reminder[];
  } catch (err) {
    // Corrupted JSON – back up and start fresh
    const backup = filePath + ".bak";
    writeFileSync(backup, raw, DEFAULT_ENCODING);
    console.warn(
      `[RemindersStore] Corrupted JSON detected. ` +
        `Backup saved to ${backup}. Resetting to empty array.`
    );
    writeFileSync(filePath, "[]", DEFAULT_ENCODING);
    return [];
  }
}

function writeReminders(filePath: string, reminders: Reminder[]): void {
  ensureFile(filePath);
  const json = JSON.stringify(reminders, null, 2);
  writeFileSync(filePath, json, DEFAULT_ENCODING);
}

function isValidRepeat(value: unknown): value is RepeatMode {
  return (
    value === null ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly" ||
    value === "weekday"
  );
}

// ---------------------------------------------------------------------------
// RemindersStore
// ---------------------------------------------------------------------------

export class RemindersStore {
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = resolve(
      filePath ?? resolve(process.cwd(), "config", "reminders.json")
    );
  }

  // ---- CRUD operations ---------------------------------------------------

  /** Add a new reminder and persist. Returns the created reminder. */
  add(
    data: Omit<Reminder, "id"> & { id?: string }
  ): Reminder {
    const reminders = readReminders(this.filePath);

    const reminder: Reminder = {
      id: data.id ?? uuidv4(),
      title: String(data.title ?? ""),
      message: String(data.message ?? ""),
      time: data.time ?? new Date().toISOString(),
      repeat: isValidRepeat(data.repeat) ? data.repeat : null,
      enabled: typeof data.enabled === "boolean" ? data.enabled : true,
    };

    // Ensure unique id
    if (reminders.some((r) => r.id === reminder.id)) {
      reminder.id = uuidv4();
    }

    reminders.push(reminder);
    writeReminders(this.filePath, reminders);
    return reminder;
  }

  /** Delete a reminder by id. Returns true if deleted, false if not found. */
  delete(id: string): boolean {
    const reminders = readReminders(this.filePath);
    const index = reminders.findIndex((r) => r.id === id);
    if (index === -1) return false;

    reminders.splice(index, 1);
    writeReminders(this.filePath, reminders);
    return true;
  }

  /** Partially update a reminder. Returns the updated reminder or null. */
  update(id: string, patch: ReminderPatch): Reminder | null {
    const reminders = readReminders(this.filePath);
    const index = reminders.findIndex((r) => r.id === id);
    if (index === -1) return null;

    const existing = reminders[index];

    if (patch.title !== undefined) existing.title = String(patch.title);
    if (patch.message !== undefined) existing.message = String(patch.message);
    if (patch.time !== undefined) existing.time = String(patch.time);
    if (patch.repeat !== undefined) {
      existing.repeat = isValidRepeat(patch.repeat) ? patch.repeat : null;
    }
    if (patch.enabled !== undefined) {
      existing.enabled = Boolean(patch.enabled);
    }

    reminders[index] = existing;
    writeReminders(this.filePath, reminders);
    return existing;
  }

  /** Get all reminders. */
  getAll(): Reminder[] {
    return readReminders(this.filePath);
  }

  /** Get a single reminder by id. Returns null if not found. */
  getById(id: string): Reminder | null {
    const reminders = readReminders(this.filePath);
    return reminders.find((r) => r.id === id) ?? null;
  }

  /** Get only enabled reminders. */
  getEnabled(): Reminder[] {
    return readReminders(this.filePath).filter((r) => r.enabled);
  }
}
