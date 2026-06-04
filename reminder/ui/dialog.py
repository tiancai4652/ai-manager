# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from typing import Callable, Optional

import customtkinter as ctk

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
DIALOG_WIDTH = 450
DIALOG_HEIGHT = 550

# 类型选项：显示文本 → 内部 key
TYPE_OPTIONS: list[str] = ["单次", "每天", "每周几", "每隔N分钟", "每月某天"]
TYPE_MAP: dict[str, str] = {
    "单次": "one_time",
    "每天": "daily",
    "每周几": "weekly",
    "每隔N分钟": "interval",
    "每月某天": "monthly",
}
TYPE_MAP_REVERSE: dict[str, str] = {v: k for k, v in TYPE_MAP.items()}

WEEKDAY_NAMES: list[str] = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

# 验证正则
_RE_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RE_TIME = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")

# 配色（与 main_window.py 一致）
ACCENT = "#3B82F6"
SUCCESS = "#22C55E"
SUCCESS_HOVER = "#16A34A"
TEXT_PRIMARY = "#E5E7EB"
TEXT_SECONDARY = "#9CA3AF"
ERROR_BORDER = "#EF4444"


# ---------------------------------------------------------------------------
# AddEditDialog
# ---------------------------------------------------------------------------
class AddEditDialog(ctk.CTkToplevel):
    """添加 / 编辑提醒对话框。"""

    def __init__(
        self,
        parent: ctk.CTk,
        reminder_data: Optional[dict] = None,
        on_save: Optional[Callable[[dict], None]] = None,
    ):
        super().__init__(parent)

        self._reminder_data = reminder_data
        self._on_save = on_save
        self._is_edit = reminder_data is not None

        # ---- 窗口属性 ----
        self.title("编辑提醒" if self._is_edit else "添加提醒")
        self.geometry(f"{DIALOG_WIDTH}x{DIALOG_HEIGHT}")
        self.resizable(False, False)
        self._center_on_parent(parent)
        self.grab_set()

        # ---- 内部状态 ----
        self._weekday_vars: list[ctk.BooleanVar] = []
        self._dynamic_widgets: list[ctk.CTkBaseClass] = []

        # ---- 构建 UI ----
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self._build_form()

        # 编辑模式：预填数据
        if self._is_edit:
            self._prefill(reminder_data)

    # ------------------------------------------------------------------
    # 居中于父窗口
    # ------------------------------------------------------------------
    def _center_on_parent(self, parent: ctk.CTk) -> None:
        parent.update_idletasks()
        px = parent.winfo_x()
        py = parent.winfo_y()
        pw = parent.winfo_width()
        ph = parent.winfo_height()
        x = px + (pw - DIALOG_WIDTH) // 2
        y = py + (ph - DIALOG_HEIGHT) // 2
        self.geometry(f"{DIALOG_WIDTH}x{DIALOG_HEIGHT}+{x}+{y}")

    # ------------------------------------------------------------------
    # 构建表单
    # ------------------------------------------------------------------
    def _build_form(self) -> None:
        container = ctk.CTkFrame(self, fg_color="transparent")
        container.grid(row=0, column=0, sticky="nsew", padx=24, pady=20)
        container.grid_columnconfigure(0, weight=1)

        row = 0

        # ---- 标题 ----
        ctk.CTkLabel(
            container, text="标题", font=ctk.CTkFont(size=13, weight="bold")
        ).grid(row=row, column=0, sticky="w", pady=(0, 4))
        row += 1

        self._title_entry = ctk.CTkEntry(
            container,
            placeholder_text="输入提醒标题",
            height=36,
            corner_radius=8,
            font=ctk.CTkFont(size=13),
        )
        self._title_entry.grid(row=row, column=0, sticky="ew", pady=(0, 12))
        row += 1

        # ---- 内容 ----
        ctk.CTkLabel(
            container, text="内容", font=ctk.CTkFont(size=13, weight="bold")
        ).grid(row=row, column=0, sticky="w", pady=(0, 4))
        row += 1

        self._content_textbox = ctk.CTkTextbox(
            container,
            height=100,
            corner_radius=8,
            font=ctk.CTkFont(size=13),
        )
        self._content_textbox.grid(row=row, column=0, sticky="ew", pady=(0, 12))
        row += 1

        # ---- 提醒类型 ----
        ctk.CTkLabel(
            container, text="提醒类型", font=ctk.CTkFont(size=13, weight="bold")
        ).grid(row=row, column=0, sticky="w", pady=(0, 4))
        row += 1

        self._type_menu = ctk.CTkOptionMenu(
            container,
            values=TYPE_OPTIONS,
            height=36,
            corner_radius=8,
            font=ctk.CTkFont(size=13),
            command=self._on_type_changed,
        )
        self._type_menu.grid(row=row, column=0, sticky="ew", pady=(0, 12))
        row += 1

        # ---- 动态字段容器 ----
        self._dynamic_frame = ctk.CTkFrame(container, fg_color="transparent")
        self._dynamic_frame.grid(row=row, column=0, sticky="ew", pady=(0, 12))
        self._dynamic_frame.grid_columnconfigure(0, weight=1)
        self._dynamic_row = row
        row += 1

        # ---- 底部按钮 ----
        btn_frame = ctk.CTkFrame(container, fg_color="transparent")
        btn_frame.grid(row=row, column=0, sticky="ew", pady=(4, 0))
        btn_frame.grid_columnconfigure(0, weight=1)

        ctk.CTkButton(
            btn_frame,
            text="取消",
            width=100,
            height=36,
            corner_radius=8,
            fg_color="transparent",
            border_width=1,
            text_color=TEXT_SECONDARY,
            font=ctk.CTkFont(size=13),
            command=self.destroy,
        ).pack(side="right", padx=(8, 0))

        ctk.CTkButton(
            btn_frame,
            text="保存",
            width=100,
            height=36,
            corner_radius=8,
            fg_color=SUCCESS,
            hover_color=SUCCESS_HOVER,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._on_save_click,
        ).pack(side="right")

        # 初始渲染动态字段（默认"单次"）
        self._on_type_changed(self._type_menu.get())

    # ------------------------------------------------------------------
    # 动态字段：根据类型清空并重建
    # ------------------------------------------------------------------
    def _clear_dynamic(self) -> None:
        for w in self._dynamic_widgets:
            w.destroy()
        self._dynamic_widgets.clear()
        self._weekday_vars.clear()
        self._date_entry = None
        self._time_entry = None
        self._interval_entry = None
        self._month_day_entry = None

    def _on_type_changed(self, selected: str) -> None:
        self._clear_dynamic()
        parent = self._dynamic_frame
        r = 0

        rtype = TYPE_MAP.get(selected, "one_time")

        if rtype == "one_time":
            # 日期 + 时间
            ctk.CTkLabel(
                parent, text="日期 (YYYY-MM-DD)", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 2))
            r += 1
            self._date_entry = ctk.CTkEntry(
                parent, placeholder_text="YYYY-MM-DD", height=32, corner_radius=6,
            )
            self._date_entry.grid(row=r, column=0, sticky="ew", pady=(0, 8))
            self._dynamic_widgets.append(self._date_entry)
            r += 1

            ctk.CTkLabel(
                parent, text="时间 (HH:MM)", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 2))
            r += 1
            self._time_entry = ctk.CTkEntry(
                parent, placeholder_text="HH:MM", height=32, corner_radius=6,
            )
            self._time_entry.grid(row=r, column=0, sticky="ew")
            self._dynamic_widgets.append(self._time_entry)

        elif rtype == "daily":
            ctk.CTkLabel(
                parent, text="时间 (HH:MM)", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 2))
            r += 1
            self._time_entry = ctk.CTkEntry(
                parent, placeholder_text="HH:MM", height=32, corner_radius=6,
            )
            self._time_entry.grid(row=r, column=0, sticky="ew")
            self._dynamic_widgets.append(self._time_entry)

        elif rtype == "weekly":
            ctk.CTkLabel(
                parent, text="选择星期", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 4))
            r += 1
            cb_frame = ctk.CTkFrame(parent, fg_color="transparent")
            cb_frame.grid(row=r, column=0, sticky="ew")
            self._dynamic_widgets.append(cb_frame)
            for i, name in enumerate(WEEKDAY_NAMES):
                var = ctk.BooleanVar(value=False)
                self._weekday_vars.append(var)
                cb = ctk.CTkCheckBox(
                    cb_frame, text=name, variable=var, width=60, corner_radius=4,
                )
                cb.grid(row=0, column=i, padx=(0, 4))
                self._dynamic_widgets.append(cb)

            r += 1
            ctk.CTkLabel(
                parent, text="时间 (HH:MM)", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(8, 2))
            r += 1
            self._time_entry = ctk.CTkEntry(
                parent, placeholder_text="HH:MM", height=32, corner_radius=6,
            )
            self._time_entry.grid(row=r, column=0, sticky="ew")
            self._dynamic_widgets.append(self._time_entry)

        elif rtype == "interval":
            ctk.CTkLabel(
                parent, text="间隔分钟数", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 2))
            r += 1
            self._interval_entry = ctk.CTkEntry(
                parent, placeholder_text="如 30", height=32, corner_radius=6,
            )
            self._interval_entry.grid(row=r, column=0, sticky="ew")
            self._dynamic_widgets.append(self._interval_entry)

        elif rtype == "monthly":
            ctk.CTkLabel(
                parent, text="每月第几天 (1-31)", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 2))
            r += 1
            self._month_day_entry = ctk.CTkEntry(
                parent, placeholder_text="1-31", height=32, corner_radius=6,
            )
            self._month_day_entry.grid(row=r, column=0, sticky="ew", pady=(0, 8))
            self._dynamic_widgets.append(self._month_day_entry)
            r += 1

            ctk.CTkLabel(
                parent, text="时间 (HH:MM)", font=ctk.CTkFont(size=12),
            ).grid(row=r, column=0, sticky="w", pady=(0, 2))
            r += 1
            self._time_entry = ctk.CTkEntry(
                parent, placeholder_text="HH:MM", height=32, corner_radius=6,
            )
            self._time_entry.grid(row=r, column=0, sticky="ew")
            self._dynamic_widgets.append(self._time_entry)

    # ------------------------------------------------------------------
    # 编辑模式预填
    # ------------------------------------------------------------------
    def _prefill(self, data: dict) -> None:
        # 标题
        title = data.get("title", "")
        if title:
            self._title_entry.insert(0, title)

        # 内容
        content = data.get("content", "")
        if content:
            self._content_textbox.insert("1.0", content)

        # 类型
        rtype = data.get("reminder_type", "one_time")
        display = TYPE_MAP_REVERSE.get(rtype, "单次")
        self._type_menu.set(display)
        self._on_type_changed(display)

        # 根据类型填充动态字段
        if rtype == "one_time":
            td = data.get("trigger_date", "")
            if td and self._date_entry:
                self._date_entry.insert(0, td)
            tt = data.get("trigger_time", "")
            if tt and self._time_entry:
                self._time_entry.insert(0, tt)

        elif rtype == "daily":
            tt = data.get("trigger_time", "")
            if tt and self._time_entry:
                self._time_entry.insert(0, tt)

        elif rtype == "weekly":
            weekdays = data.get("weekdays", [])
            for i, var in enumerate(self._weekday_vars):
                if (i + 1) in weekdays:
                    var.set(True)
            tt = data.get("trigger_time", "")
            if tt and self._time_entry:
                self._time_entry.insert(0, tt)

        elif rtype == "interval":
            mins = data.get("interval_minutes", 0)
            if mins and self._interval_entry:
                self._interval_entry.insert(0, str(mins))

        elif rtype == "monthly":
            md = data.get("month_day", 0)
            if md and self._month_day_entry:
                self._month_day_entry.insert(0, str(md))
            tt = data.get("trigger_time", "")
            if tt and self._time_entry:
                self._time_entry.insert(0, tt)

    # ------------------------------------------------------------------
    # 验证 & 保存
    # ------------------------------------------------------------------
    def _validate(self) -> Optional[str]:
        """验证表单，返回错误信息；通过则返回 None。"""
        title = self._title_entry.get().strip()
        if not title:
            self._title_entry.configure(border_color=ERROR_BORDER)
            return "标题不能为空"

        selected = self._type_menu.get()
        rtype = TYPE_MAP.get(selected, "one_time")

        if rtype == "one_time":
            date_val = self._date_entry.get().strip() if self._date_entry else ""
            if date_val and not _RE_DATE.match(date_val):
                return "日期格式应为 YYYY-MM-DD"
            time_val = self._time_entry.get().strip() if self._time_entry else ""
            if time_val and not _RE_TIME.match(time_val):
                return "时间格式应为 HH:MM（24小时制）"

        elif rtype == "daily":
            time_val = self._time_entry.get().strip() if self._time_entry else ""
            if time_val and not _RE_TIME.match(time_val):
                return "时间格式应为 HH:MM（24小时制）"

        elif rtype == "weekly":
            time_val = self._time_entry.get().strip() if self._time_entry else ""
            if time_val and not _RE_TIME.match(time_val):
                return "时间格式应为 HH:MM（24小时制）"

        elif rtype == "interval":
            mins = self._interval_entry.get().strip() if self._interval_entry else ""
            if mins:
                try:
                    v = int(mins)
                    if v <= 0:
                        return "间隔分钟数应大于 0"
                except ValueError:
                    return "间隔分钟数应为数字"

        elif rtype == "monthly":
            md = self._month_day_entry.get().strip() if self._month_day_entry else ""
            if md:
                try:
                    v = int(md)
                    if v < 1 or v > 31:
                        return "每月日期应在 1-31 之间"
                except ValueError:
                    return "每月日期应为数字"
            time_val = self._time_entry.get().strip() if self._time_entry else ""
            if time_val and not _RE_TIME.match(time_val):
                return "时间格式应为 HH:MM（24小时制）"

        return None

    def _on_save_click(self) -> None:
        error = self._validate()
        if error:
            self._show_error(error)
            return

        selected = self._type_menu.get()
        rtype = TYPE_MAP.get(selected, "one_time")

        data: dict = {
            "title": self._title_entry.get().strip(),
            "content": self._content_textbox.get("1.0", "end-1c").strip(),
            "enabled": True,
            "reminder_type": rtype,
            "trigger_time": "",
            "trigger_date": "",
            "weekdays": [],
            "interval_minutes": 0,
            "month_day": 0,
        }

        # 编辑模式保留 id
        if self._reminder_data:
            data["id"] = self._reminder_data.get("id", "")

        if rtype == "one_time":
            data["trigger_date"] = (
                self._date_entry.get().strip() if self._date_entry else ""
            )
            data["trigger_time"] = (
                self._time_entry.get().strip() if self._time_entry else ""
            )

        elif rtype == "daily":
            data["trigger_time"] = (
                self._time_entry.get().strip() if self._time_entry else ""
            )

        elif rtype == "weekly":
            data["weekdays"] = [
                i + 1 for i, var in enumerate(self._weekday_vars) if var.get()
            ]
            data["trigger_time"] = (
                self._time_entry.get().strip() if self._time_entry else ""
            )

        elif rtype == "interval":
            raw = self._interval_entry.get().strip() if self._interval_entry else "0"
            data["interval_minutes"] = int(raw) if raw else 0

        elif rtype == "monthly":
            raw = self._month_day_entry.get().strip() if self._month_day_entry else "0"
            data["month_day"] = int(raw) if raw else 0
            data["trigger_time"] = (
                self._time_entry.get().strip() if self._time_entry else ""
            )

        if self._on_save:
            self._on_save(data)

        self.destroy()

    def _show_error(self, message: str) -> None:
        """弹出错误提示（使用 CTkLabel 内嵌提示，避免额外依赖）。"""
        from tkinter import messagebox
        messagebox.showerror("验证失败", message, parent=self)
