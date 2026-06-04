# -*- coding: utf-8 -*-
"""系统托盘集成。

使用 pystray 在系统托盘显示图标，提供右键菜单（显示窗口、添加提醒、
暂停/恢复、退出）和双击恢复窗口。封装为 TrayManager 类供 main.py 调用。
"""
from __future__ import annotations

import logging
import threading
from typing import Callable, Optional

from PIL import Image, ImageDraw

try:
    import pystray
except ImportError:
    pystray = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 图标生成
# ---------------------------------------------------------------------------
ICON_COLOR = "#2C3E50"
ICON_SIZE = 32


def _create_icon_image(
    size: int = ICON_SIZE, color: str = ICON_COLOR
) -> Image.Image:
    """动态生成一个简洁的铃铛图标（32×32，透明背景）。

    用 Pillow 基本图形绘制：上方半圆（铃铛顶部）+ 下方梯形（铃铛身）+ 底部小圆（铃舌）。
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 解析颜色
    r = int(color[1:3], 16)
    g = int(color[3:5], 16)
    b = int(color[5:7], 16)
    fill = (r, g, b, 255)

    # 铃铛主体 — 一个近似铃铛的形状
    # 上部圆弧
    draw.ellipse([8, 2, 24, 18], fill=fill)
    # 下部梯形/矩形
    draw.rectangle([6, 12, 26, 24], fill=fill)
    # 底部弧线封口
    draw.ellipse([4, 18, 28, 28], fill=fill)
    # 中心挖空一点形成铃铛口效果
    draw.ellipse([8, 22, 24, 28], fill=(0, 0, 0, 0))
    # 铃舌
    draw.ellipse([13, 25, 19, 30], fill=fill)
    # 顶部小突起
    draw.ellipse([14, 0, 18, 4], fill=fill)

    return img


# ---------------------------------------------------------------------------
# TrayManager
# ---------------------------------------------------------------------------
class TrayManager:
    """系统托盘管理器，管理图标、菜单和生命周期。"""

    def __init__(self) -> None:
        self._icon: Optional[pystray.Icon] = None
        self._thread: Optional[threading.Thread] = None

        # 外部引用，通过 setter 注入
        self._main_window = None
        self._scheduler = None
        self._on_add_reminder: Optional[Callable] = None
        self._paused: bool = False
        self._active_count: int = 0

    # ------------------------------------------------------------------
    # 依赖注入
    # ------------------------------------------------------------------

    def set_main_window(self, window) -> None:
        """设置主窗口引用。"""
        self._main_window = window

    def set_scheduler(self, scheduler) -> None:
        """设置调度器引用。"""
        self._scheduler = scheduler

    def set_add_reminder_callback(self, callback: Callable) -> None:
        """设置「添加新提醒」回调。"""
        self._on_add_reminder = callback

    # ------------------------------------------------------------------
    # 公共方法
    # ------------------------------------------------------------------

    def run(self) -> None:
        """在 daemon 线程中启动系统托盘。"""
        if pystray is None:
            logger.warning("pystray not installed, tray disabled")
            return
        if self._thread is not None and self._thread.is_alive():
            return

        icon_image = _create_icon_image()
        menu = self._build_menu()

        self._icon = pystray.Icon(
            name="reminder",
            icon=icon_image,
            title="提醒助手",
            menu=menu,
        )
        self._icon.on_double_click = self._on_double_click

        self._thread = threading.Thread(
            target=self._icon.run, daemon=True, name="reminder-tray"
        )
        self._thread.start()
        logger.info("Tray icon started")

    def update_tooltip(self, count: int) -> None:
        """更新托盘提示文字为「提醒助手 - N 个活跃提醒」。"""
        self._active_count = count
        title = f"提醒助手 - {count} 个活跃提醒"
        if self._icon is not None:
            try:
                self._icon.title = title
            except Exception:
                logger.debug("Failed to update tooltip")

    def intercept_close_event(self, window) -> None:
        """将窗口关闭事件拦截为隐藏窗口，而非销毁退出。"""
        window.protocol("WM_DELETE_WINDOW", lambda: self._hide_window(window))

    def quit_app(self) -> None:
        """完整退出流程：停止调度器 → 隐藏托盘 → 销毁窗口。"""
        logger.info("Quitting app...")

        # 1. 停止调度器
        if self._scheduler is not None:
            try:
                self._scheduler.stop()
            except Exception:
                logger.exception("Error stopping scheduler")

        # 2. 停止托盘
        if self._icon is not None:
            try:
                self._icon.stop()
            except Exception:
                logger.exception("Error stopping tray icon")

        # 3. 销毁主窗口
        if self._main_window is not None:
            try:
                self._main_window.after(0, self._main_window.destroy)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # 菜单
    # ------------------------------------------------------------------

    def _build_menu(self) -> pystray.Menu:
        """构建右键菜单。"""
        return pystray.Menu(
            pystray.MenuItem("显示主窗口", self._menu_show_window),
            pystray.MenuItem("添加新提醒", self._menu_add_reminder),
            pystray.MenuItem(
                self._pause_label, self._menu_toggle_pause
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出", self._menu_quit),
        )

    @property
    def _pause_label(self) -> str:
        return "恢复所有提醒" if self._paused else "暂停所有提醒"

    # ------------------------------------------------------------------
    # 菜单回调
    # ------------------------------------------------------------------

    def _menu_show_window(self, icon, item) -> None:
        """右键「显示主窗口」。"""
        self._show_window()

    def _menu_add_reminder(self, icon, item) -> None:
        """右键「添加新提醒」。"""
        if self._on_add_reminder is not None:
            self._show_window()
            if self._main_window is not None:
                self._main_window.after(100, self._on_add_reminder)

    def _menu_toggle_pause(self, icon, item) -> None:
        """右键「暂停/恢复所有提醒」。"""
        self._paused = not self._paused
        if self._scheduler is not None:
            if self._paused:
                self._scheduler.stop()
                logger.info("Reminders paused")
            else:
                self._scheduler.start()
                logger.info("Reminders resumed")
        # 重建菜单以更新标签文字
        if self._icon is not None:
            self._icon.menu = self._build_menu()
            try:
                self._icon.update_menu()
            except Exception:
                pass

    def _menu_quit(self, icon, item) -> None:
        """右键「退出」。"""
        self.quit_app()

    # ------------------------------------------------------------------
    # 双击
    # ------------------------------------------------------------------

    def _on_double_click(self, icon, item) -> None:
        """双击托盘图标显示主窗口。"""
        self._show_window()

    # ------------------------------------------------------------------
    # 窗口显隐
    # ------------------------------------------------------------------

    def _show_window(self) -> None:
        """恢复并置顶主窗口。"""
        if self._main_window is None:
            return
        try:
            self._main_window.after(0, self._do_restore)
        except Exception:
            pass

    def _do_restore(self) -> None:
        """在主线程中恢复窗口。"""
        if self._main_window is None:
            return
        self._main_window.deiconify()
        self._main_window.lift()
        self._main_window.focus_force()
        self._main_window.attributes("-topmost", True)
        self._main_window.after(200, lambda: self._main_window.attributes("-topmost", False))

    def _hide_window(self, window) -> None:
        """隐藏窗口到托盘。"""
        try:
            window.withdraw()
        except Exception:
            pass
        logger.info("Window hidden to tray")
