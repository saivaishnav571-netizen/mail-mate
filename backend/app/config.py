"""Runtime configuration for the feedback service."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "mailmate.db"
DEFAULT_SEED_PATH = Path(__file__).with_name("seed_data.json")


def _env_path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    return Path(value).expanduser().resolve() if value else default


@dataclass(frozen=True)
class Settings:
    """All paths and secrets are injectable so tests never touch real data."""

    database_url: str = field(
        default_factory=lambda: os.getenv(
            "MAILMATE_DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH.as_posix()}"
        )
    )
    data_dir: Path = field(
        default_factory=lambda: _env_path("MAILMATE_DATA_DIR", DEFAULT_DATA_DIR)
    )
    admin_token: str = field(
        default_factory=lambda: os.getenv("MAILMATE_ADMIN_TOKEN", "mailmate-admin-dev")
    )
    seed_path: Path = field(
        default_factory=lambda: _env_path("MAILMATE_SEED_PATH", DEFAULT_SEED_PATH)
    )

    @property
    def model_dir(self) -> Path:
        return self.data_dir / "models"
