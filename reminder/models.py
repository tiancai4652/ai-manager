# -*- coding: utf-8 -*-
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

ReminderType = Literal[
    "one_time", "daily", "weekly", "interval", "monthly"
]


@dataclass
class Reminder:
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    title: str = ""
    content: str = ""
    enabled: bool = True
    reminder_type: ReminderType | str = "one_time"
    trigger_time: str = "09:00"
    trigger_date: Optional[str] = None
    weekdays: list[int] = field(default_factory=list)
    interval_minutes: int = 0
    month_day: int = 1
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    last_triggered_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "content": self.content,
            "enabled": self.enabled,
            "reminder_type": self.reminder_type,
            "trigger_time": self.trigger_time,
            "trigger_date": self.trigger_date,
            "weekdays": self.weekdays,
            "interval_minutes": self.interval_minutes,
            "month_day": self.month_day,
            "created_at": self.created_at,
            "last_triggered_at": self.last_triggered_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Reminder:
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
