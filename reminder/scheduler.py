# -*- coding: utf-8 -*-
"""提醒调度引擎。

在后台 daemon 线程中每秒轮询一次所有已启用的提醒，判断是否到达触发时间。
到达时调用 callback 通知上层（如弹出窗口 / 系统通知），并持久化 last_triggered_at。

用法::

    from reminder.scheduler import ReminderScheduler
    from reminder import storage

    def on_trigger(reminder):
        print(f"触发: {reminder.title}")

    scheduler = ReminderScheduler(callback=on_trigger)
    scheduler.start()
    ...
    scheduler.stop()
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime, time as dt_time, timedelta
from typing import Callable, Optional

from reminder import storage

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _parse_trigger_time(reminder) -> Optional[dt_time]:
    """将 reminder.trigger_time（"HH:MM" 字符串）解析为 time 对象。

    空字符串或格式不符时返回 None。
    """
    raw = getattr(reminder, "trigger_time", "")
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%H:%M").time()
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# ReminderScheduler
# ---------------------------------------------------------------------------

class ReminderScheduler:
    """定时检查并触发提醒的后台调度器。"""

    def __init__(self, callback: Callable) -> None:
        """
        Parameters
        ----------
        callback : Callable
            触发提醒时调用的回调，参数为 reminder 对象。
        """
        self._callback = callback
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    # 公共接口
    # ------------------------------------------------------------------

    def start(self) -> None:
        """启动后台轮询线程（daemon）。"""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                logger.warning("Scheduler already running")
                return
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._poll_loop, daemon=True, name="reminder-scheduler"
            )
            self._thread.start()
        logger.info("Scheduler started")

    def stop(self) -> None:
        """设置停止标志，唤醒并等待后台线程结束。"""
        self._stop_event.set()
        with self._lock:
            thread = self._thread
        if thread is not None:
            thread.join(timeout=3)
            if thread.is_alive():
                logger.warning("Scheduler thread did not stop within timeout")
            else:
                logger.info("Scheduler stopped")

    # ------------------------------------------------------------------
    # 后台循环
    # ------------------------------------------------------------------

    def _poll_loop(self) -> None:
        """每秒检查一次所有 enabled 提醒是否该触发。"""
        while not self._stop_event.is_set():
            try:
                self._check_reminders()
            except Exception:
                logger.exception("Error in poll loop")
            # 可中断的 1 秒等待
            self._stop_event.wait(timeout=1)

    def _check_reminders(self) -> None:
        """单次检查：遍历 enabled 提醒，触发到期的。"""
        now = datetime.now()

        try:
            reminders = storage.load_enabled_reminders()
        except Exception:
            logger.exception("Failed to load reminders")
            return

        for r in reminders:
            try:
                nxt = self.get_next_trigger(r)
            except Exception:
                logger.exception("Failed to compute next trigger for %s", r.id)
                continue

            if nxt is None or nxt > now:
                continue

            # 避免重复触发：如果 last_triggered_at 已等于本次触发时间则跳过
            last_raw = getattr(r, "last_triggered_at", None)
            if last_raw:
                try:
                    last_dt = datetime.fromisoformat(last_raw)
                    # 去掉秒以下精度比较
                    if last_dt.replace(microsecond=0) >= nxt.replace(microsecond=0):
                        continue
                except (ValueError, TypeError):
                    pass

            # 记录并持久化
            triggered_at = now.isoformat()
            logger.info("Triggering reminder: %s (%s)", r.title, r.id)

            with self._lock:
                try:
                    storage.update_reminder(r.id, last_triggered_at=triggered_at)
                except Exception:
                    logger.exception("Failed to persist last_triggered_at for %s", r.id)

            # 回调在锁外调用
            try:
                self._callback(r)
            except Exception:
                logger.exception("Callback error for reminder %s", r.id)

    # ------------------------------------------------------------------
    # 触发时间计算
    # ------------------------------------------------------------------

    def get_next_trigger(self, reminder) -> Optional[datetime]:
        """根据提醒类型计算下次触发时间。

        Parameters
        ----------
        reminder :
            字段与 ``Reminder`` 数据类一致，关键属性：
            - reminder_type      : str                  "one_time" / "daily" / …
            - trigger_date       : str | None  ISO       （one_time）
            - trigger_time       : str  "HH:MM"          （daily / weekly / monthly）
            - weekdays           : list[int] 1-7         （weekly, 1=周一 7=周日）
            - month_day          : int 1-31              （monthly）
            - interval_minutes   : int                   （interval）
            - last_triggered_at  : str | None  ISO       （interval）

        Returns
        -------
        datetime | None
            下次应触发的时间，无法计算时返回 None。
        """
        rtype = getattr(reminder, "reminder_type", "")

        if rtype == "one_time":
            return self._next_one_time(reminder)
        if rtype == "daily":
            return self._next_daily(reminder)
        if rtype == "weekly":
            return self._next_weekly(reminder)
        if rtype == "interval":
            return self._next_interval(reminder)
        if rtype == "monthly":
            return self._next_monthly(reminder)

        logger.debug("Unknown reminder_type: %s", rtype)
        return None

    # ---- 各类型具体计算 ----

    @staticmethod
    def _next_one_time(reminder) -> Optional[datetime]:
        raw = getattr(reminder, "trigger_date", None)
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw)
        except (ValueError, TypeError):
            return None
        # 已过期则不再触发
        if dt < datetime.now():
            return None
        return dt

    @staticmethod
    def _next_daily(reminder) -> Optional[datetime]:
        t = _parse_trigger_time(reminder)
        if t is None:
            return None
        now = datetime.now()
        candidate = now.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    @staticmethod
    def _next_weekly(reminder) -> Optional[datetime]:
        t = _parse_trigger_time(reminder)
        weekdays: list[int] = getattr(reminder, "weekdays", [])
        if t is None or not weekdays:
            return None
        now = datetime.now()
        candidate = now.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)

        # weekdays: 1=周一 … 7=周日 → Python weekday(): 0=周一 … 6=周日
        current_wd = now.weekday()
        best_delta: Optional[int] = None
        for target_wd in weekdays:
            py_wd = target_wd - 1
            delta = (py_wd - current_wd) % 7
            if delta == 0 and candidate <= now:
                delta = 7
            if best_delta is None or delta < best_delta:
                best_delta = delta

        return candidate + timedelta(days=best_delta)

    @staticmethod
    def _next_interval(reminder) -> Optional[datetime]:
        minutes: int = getattr(reminder, "interval_minutes", 0)
        if minutes <= 0:
            return None
        raw = getattr(reminder, "last_triggered_at", None)
        if not raw:
            # 从未触发过，立即触发
            return datetime.now()
        try:
            last = datetime.fromisoformat(raw)
        except (ValueError, TypeError):
            return datetime.now()
        return last + timedelta(minutes=minutes)

    @staticmethod
    def _next_monthly(reminder) -> Optional[datetime]:
        t = _parse_trigger_time(reminder)
        target_day: int = getattr(reminder, "month_day", 1)
        if t is None:
            return None
        now = datetime.now()

        import calendar

        def _build(year: int, month: int) -> datetime:
            max_day = calendar.monthrange(year, month)[1]
            day = min(target_day, max_day)
            return datetime(year, month, day, t.hour, t.minute, 0)

        candidate = _build(now.year, now.month)
        if candidate <= now:
            year, month = now.year, now.month + 1
            if month > 12:
                year += 1
                month = 1
            candidate = _build(year, month)
        return candidate


# ---------------------------------------------------------------------------
# 独立测试
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import time as _time

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # ---- 构造 mock 数据（不依赖磁盘） ----
    from reminder.models import Reminder

    triggered: list[Reminder] = []

    def mock_callback(r: Reminder) -> None:
        triggered.append(r)
        logger.info(">> CALLBACK: %s", r.title)

    # 1) interval 类型，last_triggered_at=None → 立即触发
    # 2) one_time 已过期 → 不触发
    # 3) daily 未来时间 → 本轮不触发
    future_time = (datetime.now() + timedelta(hours=1)).strftime("%H:%M")

    mock_reminders = [
        Reminder(
            id="test_interval",
            title="间隔提醒（立即触发）",
            reminder_type="interval",
            interval_minutes=60,
            enabled=True,
        ),
        Reminder(
            id="test_past",
            title="过期不触发",
            reminder_type="one_time",
            trigger_date="2020-01-01T09:00:00",
            enabled=True,
        ),
        Reminder(
            id="test_future_daily",
            title="未来 daily（本轮不触发）",
            reminder_type="daily",
            trigger_time=future_time,
            enabled=True,
        ),
        Reminder(
            id="test_disabled",
            title="已禁用",
            reminder_type="interval",
            interval_minutes=60,
            enabled=False,
        ),
    ]

    # 临时替换 storage.load_enabled_reminders
    _orig = storage.load_enabled_reminders
    storage.load_enabled_reminders = lambda: [r for r in mock_reminders if r.enabled]

    # 临时替换 storage.update_reminder 为空操作
    _orig_update = storage.update_reminder
    storage.update_reminder = lambda *a, **kw: None

    sched = ReminderScheduler(callback=mock_callback)
    sched.start()

    logger.info("Waiting up to 10 seconds for trigger...")
    for _ in range(20):
        _time.sleep(0.5)
        if triggered:
            break

    sched.stop()

    # 恢复
    storage.load_enabled_reminders = _orig
    storage.update_reminder = _orig_update

    print(f"\nTriggered {len(triggered)} reminder(s):")
    for r in triggered:
        print(f"  - {r.title} ({r.reminder_type})")

    assert any(r.id == "test_interval" for r in triggered), "interval (no last) should fire immediately"
    assert not any(r.id == "test_past" for r in triggered), "past one_time should not fire"
    assert not any(r.id == "test_future_daily" for r in triggered), "future daily should not fire this round"
    assert not any(r.id == "test_disabled" for r in triggered), "disabled should not fire"
    print("All assertions passed.")
