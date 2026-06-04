"use strict";

const { CronJob } = require("cron");

// ---------------------------------------------------------------------------
// Due-check helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `now` falls in the same minute as `targetTime`,
 * taking the repeat mode into account.
 *
 * @param {import("./data/reminders").Reminder} reminder
 * @param {Date} now
 */
function isDue(reminder, now) {
  const target = new Date(reminder.time);

  // Match down to the minute — hour and minute must match exactly
  if (now.getHours() !== target.getHours()) return false;
  if (now.getMinutes() !== target.getMinutes()) return false;

  switch (reminder.repeat) {
    // One-time: also require the full date to match
    case null:
      return (
        now.getFullYear() === target.getFullYear() &&
        now.getMonth() === target.getMonth() &&
        now.getDate() === target.getDate()
      );

    // Every day: hour:minute already matched above
    case "daily":
      return true;

    // Same day of the week (0=Sun … 6=Sat)
    case "weekly":
      return now.getDay() === target.getDay();

    // Monday–Friday (1–5)
    case "weekday": {
      const dow = now.getDay();
      return dow >= 1 && dow <= 5;
    }

    // Same day of the month
    case "monthly":
      return now.getDate() === target.getDate();

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// ReminderScheduler
// ---------------------------------------------------------------------------

class ReminderScheduler {
  /** @type {import("./data/reminders").RemindersStore} */
  #store;

  /** @type {(reminder: import("./data/reminders").Reminder) => void} */
  #onTrigger;

  /** @type {CronJob | null} */
  #job = null;

  /**
   * Tracks already-fired keys `"id:YYYY-MM-DDTHH:mm"` so the same reminder
   * can never fire twice in the same minute, even if check() runs again.
   * @type {Set<string>}
   */
  #firedKeys = new Set();

  /**
   * @param {import("./data/reminders").RemindersStore} store
   * @param {(reminder: import("./data/reminders").Reminder) => void} onTrigger
   */
  constructor(store, onTrigger) {
    if (!store || typeof store.getEnabled !== "function") {
      throw new TypeError("ReminderScheduler: a valid RemindersStore is required");
    }
    if (typeof onTrigger !== "function") {
      throw new TypeError("ReminderScheduler: onTrigger must be a function");
    }
    this.#store = store;
    this.#onTrigger = onTrigger;
  }

  // ---- Public API --------------------------------------------------------

  /**
   * Start the scheduler — a cron job that fires every minute.
   * @param {string} [cronExpression="* * * * *"]
   */
  start(cronExpression = "* * * * *") {
    if (this.#job) {
      console.warn("[ReminderScheduler] Already running — call stop() first.");
      return;
    }

    this.#job = new CronJob(
      cronExpression,
      () => this.#check(),
      null, // onComplete
      true, // start immediately
      Intl.DateTimeFormat().resolvedOptions().timeZone // local timezone
    );

    console.log(
      `[ReminderScheduler] Started — cron "${cronExpression}", ` +
        `timezone "${this.#job.running ? "active" : "inactive"}"`
    );
  }

  /** Stop the scheduler and clean up. */
  stop() {
    if (!this.#job) return;
    this.#job.stop();
    this.#job = null;
    this.#firedKeys.clear();
    console.log("[ReminderScheduler] Stopped.");
  }

  /** Is the scheduler currently running? */
  get running() {
    return this.#job != null;
  }

  // ---- Internal ----------------------------------------------------------

  /** Called every minute by the cron job. */
  #check() {
    const now = new Date();
    // Build the minute-level key prefix (YYYY-MM-DDTHH:mm)
    const minuteKey = now.toISOString().slice(0, 16);

    let reminders;
    try {
      reminders = this.#store.getEnabled();
    } catch (err) {
      console.error("[ReminderScheduler] Failed to read reminders:", err.message);
      return;
    }

    for (const reminder of reminders) {
      const firedKey = `${reminder.id}:${minuteKey}`;

      // Already triggered in this exact minute — skip
      if (this.#firedKeys.has(firedKey)) continue;

      if (isDue(reminder, now)) {
        this.#firedKeys.add(firedKey);
        this.#fire(reminder);
      }
    }

    // Prune old firedKeys (keep only keys from the last 2 minutes)
    this.#pruneFiredKeys(minuteKey);
  }

  /**
   * Fire a reminder: invoke the callback, then handle post-trigger logic.
   * @param {import("./data/reminders").Reminder} reminder
   */
  #fire(reminder) {
    try {
      this.#onTrigger(reminder);
    } catch (err) {
      console.error(
        `[ReminderScheduler] onTrigger error for "${reminder.title}":`,
        err.message
      );
    }

    // One-time reminders are deleted after firing
    if (reminder.repeat === null) {
      try {
        this.#store.delete(reminder.id);
        console.log(
          `[ReminderScheduler] One-time reminder "${reminder.title}" (${reminder.id}) deleted.`
        );
      } catch (err) {
        console.error(
          `[ReminderScheduler] Failed to delete "${reminder.id}":`,
          err.message
        );
      }
    } else {
      console.log(
        `[ReminderScheduler] Repeating reminder "${reminder.title}" (${reminder.repeat}) triggered.`
      );
    }
  }

  /**
   * Remove fired keys that are older than the current minute
   * to prevent the Set from growing unbounded.
   * @param {string} currentMinute "YYYY-MM-DDTHH:mm"
   */
  #pruneFiredKeys(currentMinute) {
    const nowMs = new Date(currentMinute).getTime();
    for (const key of this.#firedKeys) {
      // key format: "id:YYYY-MM-DDTHH:mm"
      const minutePart = key.slice(key.indexOf(":") + 1);
      const keyMs = new Date(minutePart).getTime();
      // Keep entries within the last 2 minutes (safety margin)
      if (nowMs - keyMs > 120_000) {
        this.#firedKeys.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { ReminderScheduler, isDue };
