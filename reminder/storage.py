# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
from pathlib import Path

from reminder.models import Reminder


def _get_data_dir() -> Path:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "ai-manager"
    return Path.home() / ".ai-manager"


def _get_data_path() -> Path:
    return _get_data_dir() / "reminder_data.json"


def _ensure_dir() -> None:
    _get_data_dir().mkdir(parents=True, exist_ok=True)


def load_reminders() -> list[Reminder]:
    path = _get_data_path()
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return [Reminder.from_dict(item) for item in data]
    except (json.JSONDecodeError, OSError, TypeError):
        return []


def save_reminders(reminders: list[Reminder]) -> None:
    _ensure_dir()
    path = _get_data_path()
    data = [r.to_dict() for r in reminders]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def add_reminder(reminder: Reminder) -> None:
    reminders = load_reminders()
    reminders.append(reminder)
    save_reminders(reminders)


def update_reminder(reminder_id: str, **kwargs) -> None:
    reminders = load_reminders()
    for r in reminders:
        if r.id == reminder_id:
            for key, value in kwargs.items():
                if hasattr(r, key):
                    setattr(r, key, value)
            break
    save_reminders(reminders)


def delete_reminder(reminder_id: str) -> None:
    reminders = load_reminders()
    reminders = [r for r in reminders if r.id != reminder_id]
    save_reminders(reminders)


def toggle_reminder(reminder_id: str) -> None:
    reminders = load_reminders()
    for r in reminders:
        if r.id == reminder_id:
            r.enabled = not r.enabled
            break
    save_reminders(reminders)


def load_enabled_reminders() -> list[Reminder]:
    return [r for r in load_reminders() if r.enabled]
