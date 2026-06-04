# -*- coding: utf-8 -*-
"""提醒弹窗组件。

在提醒触发时弹出置顶窗口，显示提醒标题、内容和类型标签，
播放系统提示音，支持多弹窗错位排列。
"""
from __future__ import annotations

import platform
from typing import Optional

import customtkinter as ctk

# ---------------------------------------------------------------------------
# 提示音（仅 Windows）
# ---------------------------------------------------------------------------
try:
    import winsound
except ImportError:
    winsound = None  # type: ignore[assignment]

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
POPUP_WIDTH = 400
POPUP_HEIGHT = 300
OFFSET_STEP = 30  # 多弹窗错位像素

# 类型 → (标签文本, 标签背景色, 标签文字色)
TYPE_COLORS: dict[str, tuple[str, str, str]] = {
    "工作": ("工作", "#3B82F6", "#FFFFFF"),   # 蓝色
    "生活": ("生活", "#22C55E", "#FFFFFF"),   # 绿色
    "学习": ("学习", "#F97316", "#FFFFFF"),   # 橙色
    "默认": ("提醒", "#6B7280", "#FFFFFF"),   # 灰色
}

# reminder_type 枚举 → 中文类别映射
RTYPE_TO_LABEL: dict[str, str] = {
    "one_time": "默认",
    "daily": "默认",
    "weekly": "默认",
    "interval": "默认",
    "monthly": "默认",
}

# ---------------------------------------------------------------------------
# 多弹窗错位计数器
# ---------------------------------------------------------------------------
_popup_count: int = 0


def _acquire_offset() -> tuple[int, int]:
    """获取当前弹窗的 x/y 偏移量，并递增计数。"""
    global _popup_count
    offset = _popup_count * OFFSET_STEP
    _popup_count += 1
    return offset, offset


def _release_offset() -> None:
    """弹窗关闭时递减计数。"""
    global _popup_count
    _popup_count = max(0, _popup_count - 1)


# ---------------------------------------------------------------------------
# ReminderPopup
# ---------------------------------------------------------------------------
class ReminderPopup(ctk.CTkToplevel):
    """提醒触发弹窗，置顶显示，不会自动消失。"""

    def __init__(
        self,
        parent,
        title: str,
        content: str,
        reminder_type: str = "默认",
        **kwargs,
    ):
        super().__init__(parent, **kwargs)

        self._type_label = reminder_type

        # ---- 窗口属性 ----
        self.title(title)
        self.geometry(f"{POPUP_WIDTH}x{POPUP_HEIGHT}")
        self.resizable(False, False)
        self.attributes("-topmost", True)
        self._center_with_offset()

        # 关闭时更新计数
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        # ---- 播放提示音 ----
        self._play_beep()

        # ---- 构建布局 ----
        self.grid_rowconfigure(0, weight=0)   # 顶部标题区
        self.grid_rowconfigure(1, weight=1)   # 中间内容区，拉伸
        self.grid_rowconfigure(2, weight=0)   # 底部按钮
        self.grid_columnconfigure(0, weight=1)

        self._build_header(title)
        self._build_content(content)
        self._build_footer()

    # ------------------------------------------------------------------
    # 布局
    # ------------------------------------------------------------------

    def _build_header(self, title: str) -> None:
        """顶部标题区：带背景色的容器，包含标题文字和类型标签。"""
        label_text, label_bg, label_fg = TYPE_COLORS.get(
            self._type_label, TYPE_COLORS["默认"]
        )

        header = ctk.CTkFrame(
            self,
            fg_color=("#F0F4FF", "#1E293B"),
            corner_radius=0,
            height=72,
        )
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)
        header.grid_propagate(False)

        # 标题
        ctk.CTkLabel(
            header,
            text=title,
            font=ctk.CTkFont(size=20, weight="bold"),
            anchor="w",
        ).grid(row=0, column=0, sticky="w", padx=(20, 8), pady=(16, 4))

        # 类型标签
        tag = ctk.CTkLabel(
            header,
            text=label_text,
            font=ctk.CTkFont(size=12, weight="bold"),
            fg_color=label_bg,
            text_color=label_fg,
            corner_radius=8,
            width=52,
            height=24,
        )
        tag.grid(row=0, column=1, sticky="e", padx=(0, 20), pady=(16, 4))

    def _build_content(self, content: str) -> None:
        """中间内容区：多行文本自动换行。"""
        body = ctk.CTkFrame(self, fg_color="transparent")
        body.grid(row=1, column=0, sticky="nsew", padx=24, pady=16)
        body.grid_columnconfigure(0, weight=1)

        textbox = ctk.CTkTextbox(
            body,
            font=ctk.CTkFont(size=14),
            wrap="word",
            corner_radius=8,
            activate_scrollbars=True,
        )
        textbox.grid(row=0, column=0, sticky="nsew")
        textbox.insert("1.0", content)
        textbox.configure(state="disabled")  # 只读

    def _build_footer(self) -> None:
        """底部「知道了」按钮。"""
        footer = ctk.CTkFrame(self, fg_color="transparent", height=56)
        footer.grid(row=2, column=0, sticky="ew", padx=24, pady=(0, 16))

        ctk.CTkButton(
            footer,
            text="知道了",
            width=160,
            height=40,
            corner_radius=10,
            font=ctk.CTkFont(size=15, weight="bold"),
            fg_color="#3B82F6",
            hover_color="#2563EB",
            command=self._on_close,
        ).pack()

    # ------------------------------------------------------------------
    # 辅助
    # ------------------------------------------------------------------

    def _center_with_offset(self) -> None:
        """屏幕居中并叠加错位偏移。"""
        ox, oy = _acquire_offset()
        screen_w = self.winfo_screenwidth()
        screen_h = self.winfo_screenheight()
        x = (screen_w - POPUP_WIDTH) // 2 + ox
        y = (screen_h - POPUP_HEIGHT) // 2 + oy
        self.geometry(f"{POPUP_WIDTH}x{POPUP_HEIGHT}+{x}+{y}")

    def _on_close(self) -> None:
        """关闭弹窗并释放偏移计数。"""
        _release_offset()
        self.destroy()

    @staticmethod
    def _play_beep() -> None:
        """播放系统提示音（仅 Windows）。"""
        if winsound is None:
            return
        try:
            winsound.MessageBeep(winsound.MB_ICONEXCLAMATION)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# 独立测试
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")

    root = ctk.CTk()
    root.withdraw()

    # 测试四种类型弹窗
    demos = [
        ("项目进度会议", "今天下午 3 点与产品团队同步进度，请提前准备甘特图和里程碑报告。", "工作"),
        ("该喝水了", "你已经快两个小时没喝水了，起来倒杯水休息一下吧！", "生活"),
        ("背单词打卡", "今日任务：复习 Unit 12 的 50 个核心词汇，完成配套练习。", "学习"),
        ("定时备份", "数据库自动备份已完成，请检查日志确认无误。", "默认"),
    ]

    popups = []
    for t, c, tp in demos:
        p = ReminderPopup(root, title=t, content=c, reminder_type=tp)
        popups.append(p)

    root.mainloop()
