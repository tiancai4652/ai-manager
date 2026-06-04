# -*- coding: utf-8 -*-
"""提醒管理器 — 应用入口。

启动流程：
    初始化主题 → 加载数据 → 创建主窗口 → 创建调度器 → 创建系统托盘 →
    注入依赖 → 拦截关闭事件 → 启动后台线程 → 进入 mainloop。

退出流程（托盘「退出」触发）：
    停止调度器 → 停止托盘图标 → 销毁窗口 → 退出进程。
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime
from typing import Optional

import customtkinter as ctk

from reminder import storage
from reminder.models import Reminder
from reminder.scheduler import ReminderScheduler
from reminder.tray import TrayManager
from reminder.ui.dialog import AddEditDialog
from reminder.ui.main_window import MainWindow
from reminder.ui.popup import ReminderPopup

# ---------------------------------------------------------------------------
# 日志
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 主题（必须在创建窗口之前设置）
# ---------------------------------------------------------------------------
ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")


# ---------------------------------------------------------------------------
# App — 应用编排器
# ---------------------------------------------------------------------------
class App:
    """管理所有组件的生命周期，将 UI / 调度器 / 托盘 / 持久化粘合在一起。"""

    def __init__(self) -> None:
        self.tray = TrayManager()
        self.window: Optional[MainWindow] = None
        self.scheduler: Optional[ReminderScheduler] = None

    # ==================================================================
    # 启动
    # ==================================================================

    def run(self) -> None:
        """创建所有组件并启动应用。"""
        # 1. 加载已有数据
        reminders = storage.load_reminders()
        logger.info("Loaded %d reminder(s) from disk", len(reminders))

        # 2. 创建主窗口，注入真实数据
        self.window = MainWindow()
        self.window._reminders = [r.to_dict() for r in reminders]
        self.window._refresh_cards()

        # 3. 将 MainWindow 的事件处理连接到真实逻辑
        self._wire_main_window()

        # 4. 创建调度器（回调：弹出通知窗口）
        self.scheduler = ReminderScheduler(callback=self._on_reminder_trigger)

        # 5. 注入依赖到 TrayManager
        self.tray.set_main_window(self.window)
        self.tray.set_scheduler(self.scheduler)
        self.tray.set_add_reminder_callback(self._open_add_dialog)

        # 6. 拦截关闭按钮 → 最小化到托盘
        self.tray.intercept_close_event(self.window)

        # 7. 启动托盘 + 调度器
        self.tray.run()
        self.scheduler.start()

        # 8. 初始 tooltip
        self._refresh_tooltip()

        logger.info("Application started")
        self.window.mainloop()

    # ==================================================================
    # MainWindow 事件接线
    # ==================================================================

    def _wire_main_window(self) -> None:
        """用真实逻辑替换 MainWindow 中的占位回调。"""
        w = self.window
        if w is None:
            return

        # 「添加提醒」按钮
        w._on_add_reminder = lambda: self._open_add_dialog()

        # 卡片回调
        w._handle_toggle = self._handle_toggle
        w._handle_edit = self._handle_edit
        w._handle_delete = self._handle_delete

    # ------------------------------------------------------------------
    # 添加 / 编辑对话框
    # ------------------------------------------------------------------

    def _open_add_dialog(self) -> None:
        """打开「添加提醒」对话框。"""
        if self.window is None:
            return
        AddEditDialog(
            parent=self.window,
            reminder_data=None,
            on_save=self._on_dialog_save_add,
        )

    def _open_edit_dialog(self, reminder_id: str) -> None:
        """打开「编辑提醒」对话框。"""
        if self.window is None:
            return
        # 从内存列表中查找数据
        rd = self._find_reminder_dict(reminder_id)
        if rd is None:
            return
        AddEditDialog(
            parent=self.window,
            reminder_data=rd,
            on_save=lambda data: self._on_dialog_save_edit(reminder_id, data),
        )

    # ------------------------------------------------------------------
    # 对话框保存回调
    # ------------------------------------------------------------------

    def _on_dialog_save_add(self, data: dict) -> None:
        """添加提醒保存回调。"""
        r = Reminder(
            title=data.get("title", ""),
            content=data.get("content", ""),
            reminder_type=data.get("reminder_type", "one_time"),
            trigger_time=data.get("trigger_time", "09:00"),
            trigger_date=data.get("trigger_date") or None,
            weekdays=data.get("weekdays", []),
            interval_minutes=data.get("interval_minutes", 0),
            month_day=data.get("month_day", 1),
            enabled=True,
        )
        storage.add_reminder(r)
        if self.window:
            self.window._reminders.append(r.to_dict())
            self.window._refresh_cards()
        self._refresh_tooltip()
        logger.info("Added reminder: %s (%s)", r.title, r.id[:8])

    def _on_dialog_save_edit(self, reminder_id: str, data: dict) -> None:
        """编辑提醒保存回调。"""
        storage.update_reminder(reminder_id, **data)
        if self.window:
            for rd in self.window._reminders:
                if rd.get("id") == reminder_id:
                    rd.update(data)
                    break
            self.window._refresh_cards()
        self._refresh_tooltip()
        logger.info("Updated reminder: %s", reminder_id[:8])

    # ------------------------------------------------------------------
    # 卡片事件处理
    # ------------------------------------------------------------------

    def _handle_toggle(self, reminder_id: str, enabled: bool) -> None:
        """切换提醒开关。"""
        storage.toggle_reminder(reminder_id)
        if self.window:
            for rd in self.window._reminders:
                if rd.get("id") == reminder_id:
                    rd["enabled"] = enabled
                    break
            self.window._update_status()
        self._refresh_tooltip()
        logger.info("Toggled %s → %s", reminder_id[:8], enabled)

    def _handle_edit(self, reminder_id: str) -> None:
        """编辑提醒。"""
        self._open_edit_dialog(reminder_id)

    def _handle_delete(self, reminder_id: str) -> None:
        """删除提醒。"""
        storage.delete_reminder(reminder_id)
        if self.window:
            self.window._reminders = [
                r for r in self.window._reminders if r.get("id") != reminder_id
            ]
            self.window._refresh_cards()
        self._refresh_tooltip()
        logger.info("Deleted reminder: %s", reminder_id[:8])

    # ==================================================================
    # 调度器回调
    # ==================================================================

    def _on_reminder_trigger(self, reminder) -> None:
        """提醒触发时：弹出通知窗口 + 刷新 tooltip。"""
        if self.window is None:
            return
        self.window.after(
            0,
            lambda: ReminderPopup(
                self.window,
                title=reminder.title,
                content=reminder.content,
                reminder_type="默认",
            ),
        )
        self._refresh_tooltip()

    # ==================================================================
    # Tooltip 刷新
    # ==================================================================

    def _refresh_tooltip(self) -> None:
        """更新托盘 tooltip 中的活跃提醒数量。"""
        try:
            count = len(storage.load_enabled_reminders())
        except Exception:
            count = 0
        self.tray.update_tooltip(count)

    # ==================================================================
    # 辅助
    # ==================================================================

    def _find_reminder_dict(self, reminder_id: str) -> Optional[dict]:
        """从 MainWindow 内存列表中查找提醒字典。"""
        if self.window is None:
            return None
        for rd in self.window._reminders:
            if rd.get("id") == reminder_id:
                return rd
        return None


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def main() -> None:
    app = App()
    app.run()


if __name__ == "__main__":
    main()
