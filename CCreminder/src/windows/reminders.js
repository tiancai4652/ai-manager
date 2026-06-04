"use strict";

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const addForm      = document.getElementById("addForm");
const inputTitle   = document.getElementById("inputTitle");
const inputMessage = document.getElementById("inputMessage");
const inputTime    = document.getElementById("inputTime");
const inputRepeat  = document.getElementById("inputRepeat");
const btnAdd       = document.getElementById("btnAdd");
const listEl       = document.getElementById("reminderList");
const emptyState   = document.getElementById("emptyState");
const countBadge   = document.getElementById("countBadge");
const statusText   = document.getElementById("statusText");
const statusTime   = document.getElementById("statusTime");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPEAT_LABELS = {
  "":       "一次性",
  daily:    "每天",
  weekly:   "每周",
  monthly:  "每月",
  weekday:  "工作日",
};

/**
 * Format an ISO time string into display-friendly date + time.
 * @param {string} iso
 * @returns {{ date: string, time: string }}
 */
function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "--", time: "--:--" };

  const date = d.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
  const time = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { date, time };
}

/**
 * Set the status bar text with auto-clear after 3 seconds.
 * @param {string} text
 */
function setStatus(text) {
  statusText.textContent = text;
  clearTimeout(setStatus._timer);
  setStatus._timer = setTimeout(() => {
    statusText.textContent = "就绪";
  }, 3000);
}

/**
 * Update the clock in the status bar.
 */
function updateClock() {
  statusTime.textContent = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// IPC wrappers (use preload-style window.api or direct ipcRenderer)
// ---------------------------------------------------------------------------

/**
 * In a production Electron app the renderer calls through a preload bridge.
 * Here we support both patterns:
 *   1. window.api.invoke(channel, ...args)  — preload bridge
 *   2. Direct require("electron").ipcRenderer — for dev / testing
 */
const ipc = (() => {
  // Prefer preload bridge
  if (window.api && typeof window.api.invoke === "function") {
    return {
      invoke: (channel, ...args) => window.api.invoke(channel, ...args),
      on:     (channel, cb) => window.api.on(channel, cb),
    };
  }
  // Fallback: direct ipcRenderer (nodeIntegration must be true)
  try {
    const { ipcRenderer } = require("electron");
    return {
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      on: (channel, cb) => {
        ipcRenderer.on(channel, (_event, data) => cb(data));
      },
    };
  } catch {
    // No Electron — return no-op stubs so the UI can still be previewed
    console.warn("[reminders.js] Running outside Electron — IPC calls are no-ops.");
    return {
      invoke: async () => [],
      on: () => {},
    };
  }
})();

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a single reminder card element.
 * @param {{ id: string, title: string, message: string, time: string, repeat: string|null, enabled: boolean }} r
 * @returns {HTMLElement}
 */
function createCard(r) {
  const { date, time } = formatTime(r.time);
  const repeatKey = r.repeat || "";
  const repeatLabel = REPEAT_LABELS[repeatKey] || "一次性";

  const card = document.createElement("div");
  card.className = "reminder-card" + (r.enabled ? "" : " disabled");
  card.dataset.id = r.id;

  card.innerHTML = `
    <div class="card-time">
      <span class="time">${escHtml(time)}</span>
      <span class="date">${escHtml(date)}</span>
      <span class="repeat-badge ${escAttr(repeatKey) || "once"}">${escHtml(repeatLabel)}</span>
    </div>
    <div class="card-content">
      <div class="title">${escHtml(r.title)}</div>
      <div class="message">${escHtml(r.message || "（无内容）")}</div>
    </div>
    <div class="card-actions">
      <label class="toggle" title="${r.enabled ? "点击禁用" : "点击启用"}">
        <input type="checkbox" class="toggle-enabled" ${r.enabled ? "checked" : ""} />
        <span class="slider"></span>
      </label>
      <button class="btn-delete" title="删除此提醒">删除</button>
    </div>
  `;

  // ---- Toggle enabled/disabled ----
  const checkbox = card.querySelector(".toggle-enabled");
  checkbox.addEventListener("change", async () => {
    const enabled = checkbox.checked;
    setStatus(`${enabled ? "启用" : "禁用"}: ${r.title}…`);
    try {
      await ipc.invoke("reminders:update", r.id, { enabled });
      card.classList.toggle("disabled", !enabled);
      setStatus(`${enabled ? "已启用" : "已禁用"}: ${r.title}`);
    } catch (err) {
      checkbox.checked = !enabled; // revert on failure
      setStatus(`操作失败: ${err.message}`);
    }
  });

  // ---- Delete ----
  const btnDel = card.querySelector(".btn-delete");
  btnDel.addEventListener("click", async () => {
    if (!confirm(`确定删除提醒「${r.title}」吗？`)) return;
    setStatus(`删除中: ${r.title}…`);
    btnDel.disabled = true;
    try {
      const ok = await ipc.invoke("reminders:delete", r.id);
      if (ok) {
        card.style.transition = "opacity 0.2s, transform 0.2s";
        card.style.opacity = "0";
        card.style.transform = "translateX(30px)";
        setTimeout(() => card.remove(), 200);
        setStatus(`已删除: ${r.title}`);
        refreshBadge();
      } else {
        btnDel.disabled = false;
        setStatus(`删除失败: 未找到该提醒`);
      }
    } catch (err) {
      btnDel.disabled = false;
      setStatus(`删除失败: ${err.message}`);
    }
  });

  return card;
}

/**
 * Render the full reminder list.
 * @param {Array} reminders
 */
function renderList(reminders) {
  // Clear existing cards (keep empty state element)
  const existing = listEl.querySelectorAll(".reminder-card");
  existing.forEach((el) => el.remove());

  if (!reminders || reminders.length === 0) {
    emptyState.style.display = "flex";
  } else {
    emptyState.style.display = "none";
    // Sort by time ascending
    const sorted = [...reminders].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    for (const r of sorted) {
      listEl.appendChild(createCard(r));
    }
  }

  refreshBadge();
}

/**
 * Update the count badge in the title bar.
 */
function refreshBadge() {
  const cards = listEl.querySelectorAll(".reminder-card");
  const n = cards.length;
  countBadge.textContent = `${n} 条提醒`;
}

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

function escHtml(str) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

function escAttr(str) {
  return escHtml(str);
}

// ---------------------------------------------------------------------------
// Load reminders from main process
// ---------------------------------------------------------------------------

async function loadReminders() {
  setStatus("加载提醒列表…");
  try {
    const reminders = await ipc.invoke("reminders:getAll");
    renderList(reminders);
    setStatus("加载完成");
  } catch (err) {
    setStatus(`加载失败: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Form submission — add new reminder
// ---------------------------------------------------------------------------

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const title   = inputTitle.value.trim();
  const message = inputMessage.value.trim();
  const time    = inputTime.value;           // "YYYY-MM-DDTHH:mm"
  const repeat  = inputRepeat.value || null; // "" → null

  if (!title) {
    inputTitle.focus();
    return;
  }
  if (!time) {
    inputTime.focus();
    return;
  }

  // Convert datetime-local to ISO string
  const isoTime = new Date(time).toISOString();

  btnAdd.disabled = true;
  setStatus(`添加中: ${title}…`);

  try {
    const created = await ipc.invoke("reminders:add", {
      title,
      message,
      time: isoTime,
      repeat,
      enabled: true,
    });

    // Append card directly (avoid full reload)
    if (created) {
      emptyState.style.display = "none";
      listEl.appendChild(createCard(created));
      refreshBadge();
    }

    // Reset form
    addForm.reset();
    setStatus(`已添加: ${title}`);
  } catch (err) {
    setStatus(`添加失败: ${err.message}`);
  } finally {
    btnAdd.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Real-time updates — listen for events from main process
// ---------------------------------------------------------------------------

// When the scheduler fires a reminder, the main process sends it here
ipc.on("reminder:triggered", (reminder) => {
  // Flash the relevant card briefly
  const card = listEl.querySelector(`.reminder-card[data-id="${reminder.id}"]`);
  if (card) {
    card.style.borderColor = "#4361ee";
    card.style.boxShadow = "0 0 12px rgba(67,97,238,0.3)";
    setTimeout(() => {
      card.style.borderColor = "";
      card.style.boxShadow = "";
    }, 2000);
  }
});

// When tray menu triggers navigate, scroll or focus
ipc.on("navigate", (view) => {
  if (view === "add") {
    inputTitle.focus();
  } else if (view === "reminders") {
    listEl.scrollTop = 0;
  }
});

// ---------------------------------------------------------------------------
// Init — set default datetime-local value and load data
// ---------------------------------------------------------------------------

function initDefaults() {
  // Default time = now + 5 minutes, rounded to nearest minute
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  now.setSeconds(0);
  now.setMilliseconds(0);

  const pad = (n) => String(n).padStart(2, "0");
  const localStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  inputTime.value = localStr;
}

// ---------------------------------------------------------------------------
// Public — loadRemindersWindow (entry point callable from main process)
// ---------------------------------------------------------------------------

/**
 * Initialize the reminders window UI.
 * Call this once when the window loads.
 */
function loadRemindersWindow() {
  initDefaults();
  loadReminders();
  updateClock();
  setInterval(updateClock, 1000);
}

// Auto-init when running as a standalone page
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadRemindersWindow);
} else {
  loadRemindersWindow();
}
