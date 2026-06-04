# -*- coding: utf-8 -*-
from __future__ import annotations

import sys
import threading
from typing import Callable, Optional

import customtkinter as ctk
from PIL import Image, ImageDraw

# ---------------------------------------------------------------------------
# 系统托盘（延迟导入，仅 Windows 下使用 pystray）
# ---------------------------------------------------------------------------
try:
    import pystray
except ImportError:
    pystray = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
WINDOW_TITLE = "提醒管理器"
WINDOW_WIDTH = 800
WINDOW_HEIGHT = 600
MIN_WIDTH = 600
MIN_HEIGHT = 400

TYPE_LABELS: dict[str, str] = {
    "one_time": "一次",
    "daily": "每日",
    "weekly": "每周",
    "interval": "间隔",
    "monthly": "每月",
}

# 配色
ACCENT = "#3B82F6"
ACCENT_HOVER = "#2563EB"
DANGER = "#EF4444"
DANGER_HOVER = "#DC2626"
TEXT_PRIMARY = "#E5E7EB"
TEXT_SECONDARY = "#9CA3AF"
CARD_BG = ("#2D2D2D", "#1E1E1E")
CARD_FG = ("#CFCFCF", "#2D2D2D")
STATUS_BG = ("#EAEAEA", "#1A1A1A")


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def _generate_tray_icon(size: int = 64, color: str = ACCENT) -> Image.Image:
    """生成一个纯色圆形托盘图标。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = 4
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=color,
    )
    # 画一个简单的 "R" 字母标识
    cx, cy = size // 2, size // 2
    draw.text((cx - 8, cy - 12), "R", fill="white")
    return img


def _center_window(window: ctk.CTk, w: int, h: int) -> None:
    """将窗口居中显示。"""
    screen_w = window.winfo_screenwidth()
    screen_h = window.winfo_screenheight()
    x = (screen_w - w) // 2
    y = (screen_h - h) // 2
    window.geometry(f"{w}x{h}+{x}+{y}")


# ---------------------------------------------------------------------------
# ReminderCard — 单个提醒卡片
# ---------------------------------------------------------------------------
class ReminderCard(ctk.CTkFrame):
    """一行提醒卡片，包含标题、触发信息、类型标签、开关、编辑/删除按钮。"""

    def __init__(
        self,
        master: ctk.CTkFrame,
        reminder: dict,
        on_toggle: Optional[Callable[[str, bool], None]] = None,
        on_edit: Optional[Callable[[str], None]] = None,
        on_delete: Optional[Callable[[str], None]] = None,
        **kwargs,
    ):
        super().__init__(master, corner_radius=10, **kwargs)

        self._reminder_id: str = reminder.get("id", "")
        self._on_toggle = on_toggle
        self._on_edit = on_edit
        self._on_delete = on_delete
        self._enabled: bool = reminder.get("enabled", True)

        # ---- 整体布局：三列 ----
        self.grid_columnconfigure(0, weight=1)   # 左侧信息区，可拉伸
        self.grid_columnconfigure(1, weight=0)   # 中间开关
        self.grid_columnconfigure(2, weight=0)   # 右侧按钮

        # --- 左侧信息 ---
        left = ctk.CTkFrame(self, fg_color="transparent")
        left.grid(row=0, column=0, sticky="w", padx=(14, 8), pady=10)

        # 标题
        title_text = reminder.get("title", "未命名提醒")
        self._title_label = ctk.CTkLabel(
            left,
            text=title_text,
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=TEXT_PRIMARY,
            anchor="w",
        )
        self._title_label.pack(anchor="w")

        # 次要信息行：下次触发 + 类型标签
        info_row = ctk.CTkFrame(left, fg_color="transparent")
        info_row.pack(anchor="w", pady=(4, 0))

        trigger = reminder.get("trigger_time", "--:--")
        trigger_date = reminder.get("trigger_date")
        if trigger_date:
            trigger_info = f"{trigger_date} {trigger}"
        else:
            trigger_info = f"每天 {trigger}"

        self._time_label = ctk.CTkLabel(
            info_row,
            text=trigger_info,
            font=ctk.CTkFont(size=12),
            text_color=TEXT_SECONDARY,
        )
        self._time_label.pack(side="left", padx=(0, 10))

        rtype = reminder.get("reminder_type", "one_time")
        type_text = TYPE_LABELS.get(rtype, rtype)
        self._type_badge = ctk.CTkLabel(
            info_row,
            text=type_text,
            font=ctk.CTkFont(size=11),
            fg_color=ACCENT,
            corner_radius=6,
            width=44,
            height=22,
            text_color="white",
        )
        self._type_badge.pack(side="left")

        # --- 中间开关 ---
        self._switch = ctk.CTkSwitch(
            self,
            text="",
            width=44,
            button_color=ACCENT,
            button_hover_color=ACCENT_HOVER,
            progress_color=ACCENT,
            command=self._handle_toggle,
        )
        self._switch.grid(row=0, column=1, padx=8, pady=10)
        if self._enabled:
            self._switch.select()
        else:
            self._switch.deselect()

        # --- 右侧按钮 ---
        right = ctk.CTkFrame(self, fg_color="transparent")
        right.grid(row=0, column=2, padx=(0, 14), pady=10)

        self._edit_btn = ctk.CTkButton(
            right,
            text="编辑",
            width=52,
            height=28,
            font=ctk.CTkFont(size=12),
            fg_color="transparent",
            text_color=TEXT_SECONDARY,
            hover_color=("#D1D5DB", "#374151"),
            corner_radius=6,
            command=self._handle_edit,
        )
        self._edit_btn.pack(side="left", padx=(0, 4))

        self._delete_btn = ctk.CTkButton(
            right,
            text="删除",
            width=52,
            height=28,
            font=ctk.CTkFont(size=12),
            fg_color="transparent",
            text_color=DANGER,
            hover_color=("#FEE2E2", "#450A0A"),
            corner_radius=6,
            command=self._handle_delete,
        )
        self._delete_btn.pack(side="left")

    # ---- 回调 ----
    def _handle_toggle(self) -> None:
        self._enabled = self._switch.get()
        if self._on_toggle:
            self._on_toggle(self._reminder_id, self._enabled)

    def _handle_edit(self) -> None:
        if self._on_edit:
            self._on_edit(self._reminder_id)

    def _handle_delete(self) -> None:
        if self._on_delete:
            self._on_delete(self._reminder_id)


# ---------------------------------------------------------------------------
# MainWindow — 主窗口
# ---------------------------------------------------------------------------
class MainWindow(ctk.CTk):
    """应用主窗口：标题栏 + 可滚动提醒列表 + 底部状态栏。"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        self.title(WINDOW_TITLE)
        self.geometry(f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}")
        self.minsize(MIN_WIDTH, MIN_HEIGHT)
        _center_window(self, WINDOW_WIDTH, WINDOW_HEIGHT)

        # 系统托盘相关
        self._tray_icon: Optional[pystray.Icon] = None
        self._hidden = False
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # ---- 整体 grid 布局 ----
        self.grid_rowconfigure(1, weight=1)  # 中间列表区可拉伸
        self.grid_columnconfigure(0, weight=1)

        self._build_title_bar()
        self._build_scroll_area()
        self._build_status_bar()

        # 加载假数据
        self._reminders: list[dict] = self._fake_data()
        self._refresh_cards()

    # ------------------------------------------------------------------
    # 构建区域
    # ------------------------------------------------------------------
    def _build_title_bar(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent", height=48)
        bar.grid(row=0, column=0, sticky="ew", padx=16, pady=(12, 0))
        bar.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            bar,
            text="提醒管理器",
            font=ctk.CTkFont(size=22, weight="bold"),
            anchor="w",
        ).grid(row=0, column=0, sticky="w")

        ctk.CTkButton(
            bar,
            text="＋ 添加提醒",
            width=120,
            height=36,
            font=ctk.CTkFont(size=13),
            fg_color=ACCENT,
            hover_color=ACCENT_HOVER,
            corner_radius=8,
            command=self._on_add_reminder,
        ).grid(row=0, column=1, sticky="e")

    def _build_scroll_area(self) -> None:
        self._scroll_frame = ctk.CTkScrollableFrame(
            self,
            fg_color="transparent",
            corner_radius=0,
        )
        self._scroll_frame.grid(
            row=1, column=0, sticky="nsew", padx=16, pady=(10, 6)
        )
        self._scroll_frame.grid_columnconfigure(0, weight=1)

    def _build_status_bar(self) -> None:
        bar = ctk.CTkFrame(self, fg_color=STATUS_BG, height=36, corner_radius=0)
        bar.grid(row=2, column=0, sticky="ew")
        bar.grid_columnconfigure(0, weight=1)

        self._status_label = ctk.CTkLabel(
            bar,
            text="",
            font=ctk.CTkFont(size=12),
            anchor="w",
        )
        self._status_label.pack(side="left", padx=16, pady=6)

    # ------------------------------------------------------------------
    # 卡片渲染
    # ------------------------------------------------------------------
    def _refresh_cards(self) -> None:
        """清空并重新渲染所有提醒卡片。"""
        for child in self._scroll_frame.winfo_children():
            child.destroy()

        for i, r in enumerate(self._reminders):
            card = ReminderCard(
                self._scroll_frame,
                reminder=r,
                on_toggle=self._handle_toggle,
                on_edit=self._handle_edit,
                on_delete=self._handle_delete,
                fg_color=CARD_BG,
            )
            card.grid(row=i, column=0, sticky="ew", pady=(0, 8))

        self._update_status()

    def _update_status(self) -> None:
        total = len(self._reminders)
        active = sum(1 for r in self._reminders if r.get("enabled", True))
        self._status_label.configure(
            text=f"共 {total} 个提醒，{active} 个已启用"
        )

    # ------------------------------------------------------------------
    # 事件处理（占位，后续对接真实逻辑）
    # ------------------------------------------------------------------
    def _on_add_reminder(self) -> None:
        print("[MainWindow] 添加提醒")

    def _handle_toggle(self, reminder_id: str, enabled: bool) -> None:
        for r in self._reminders:
            if r["id"] == reminder_id:
                r["enabled"] = enabled
                break
        self._update_status()
        print(f"[MainWindow] toggle {reminder_id} -> {enabled}")

    def _handle_edit(self, reminder_id: str) -> None:
        print(f"[MainWindow] edit {reminder_id}")

    def _handle_delete(self, reminder_id: str) -> None:
        self._reminders = [
            r for r in self._reminders if r["id"] != reminder_id
        ]
        self._refresh_cards()
        print(f"[MainWindow] delete {reminder_id}")

    # ------------------------------------------------------------------
    # 窗口关闭 → 最小化到系统托盘
    # ------------------------------------------------------------------
    def _on_close(self) -> None:
        """关闭按钮 → 隐藏窗口，启动系统托盘。"""
        self.withdraw()
        self._hidden = True
        self._start_tray()

    def _start_tray(self) -> None:
        if self._tray_icon is not None:
            return
        if pystray is None:
            return

        icon_image = _generate_tray_icon()
        menu = pystray.Menu(
            pystray.MenuItem("显示窗口", self._tray_show),
            pystray.MenuItem("退出", self._tray_quit),
        )
        self._tray_icon = pystray.Icon(
            name="reminder",
            icon=icon_image,
            title="提醒管理器",
            menu=menu,
        )
        threading.Thread(
            target=self._tray_icon.run, daemon=True
        ).start()

    def _tray_show(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        """从托盘恢复窗口（在主线程中执行）。"""
        self.after(0, self._restore_window)

    def _restore_window(self) -> None:
        self.deiconify()
        self.lift()
        self.focus_force()
        self._hidden = False

    def _tray_quit(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        """退出应用。"""
        if self._tray_icon:
            self._tray_icon.stop()
            self._tray_icon = None
        self.after(0, self.destroy)

    # ------------------------------------------------------------------
    # 假数据
    # ------------------------------------------------------------------
    @staticmethod
    def _fake_data() -> list[dict]:
        return [
            {
                "id": "a1b2c3d4",
                "title": "喝水提醒",
                "content": "每小时喝一杯水",
                "enabled": True,
                "reminder_type": "interval",
                "trigger_time": "09:00",
                "trigger_date": None,
                "weekdays": [],
                "interval_minutes": 60,
                "month_day": 0,
            },
            {
                "id": "e5f6g7h8",
                "title": "团队周会",
                "content": "准备本周工作汇报",
                "enabled": True,
                "reminder_type": "weekly",
                "trigger_time": "10:00",
                "trigger_date": None,
                "weekdays": [1, 3, 5],
                "interval_minutes": 0,
                "month_day": 0,
            },
            {
                "id": "i9j0k1l2",
                "title": "生日聚会",
                "content": "给小明买蛋糕",
                "enabled": False,
                "reminder_type": "one_time",
                "trigger_time": "18:00",
                "trigger_date": "2026-06-15",
                "weekdays": [],
                "interval_minutes": 0,
                "month_day": 0,
            },
            {
                "id": "m3n4o5p6",
                "title": "信用卡还款",
                "content": "每月 10 号前还清",
                "enabled": True,
                "reminder_type": "monthly",
                "trigger_time": "08:00",
                "trigger_date": None,
                "weekdays": [],
                "interval_minutes": 0,
                "month_day": 10,
            },
        ]


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def main() -> None:
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")

    app = MainWindow()
    app.mainloop()


if __name__ == "__main__":
    main()
