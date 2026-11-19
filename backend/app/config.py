"""Runtime configuration for the feedback service."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = BACKEND_DIR / "data"
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "mailmate.db"
DEFAULT_SEED_PATH = Path(__file__).with_name("seed_data.json")


def _env_path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    return Path(value).expanduser().resolve() if value else default


def _env_origins() -> tuple[str, ...]:
    raw = os.getenv(
        "MAILMATE_ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,"
        "http://127.0.0.1:4173,http://localhost:4173",
    )
    return tuple(origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    """All paths, secrets, and origins are injectable so tests stay isolated."""

    database_url: str = field(
        default_factory=lambda: os.getenv(
            "MAILMATE_DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH.as_posix()}"
        )
    )
    data_dir: Path = field(
        default_factory=lambda: _env_path("MAILMATE_DATA_DIR", DEFAULT_DATA_DIR)
    )
    admin_token: str | None = field(
        default_factory=lambda: os.getenv("MAILMATE_ADMIN_TOKEN")
    )
    seed_path: Path = field(
        default_factory=lambda: _env_path("MAILMATE_SEED_PATH", DEFAULT_SEED_PATH)
    )
    allowed_origins: tuple[str, ...] = field(default_factory=_env_origins)

    def validate_runtime(self) -> None:
        """Fail closed when the API is started without production-safe settings."""
        if not self.admin_token or len(self.admin_token) < 32:
            raise RuntimeError(
                "MAILMATE_ADMIN_TOKEN must be set and contain at least 32 characters."
            )
        if not self.allowed_origins:
            raise RuntimeError("MAILMATE_ALLOWED_ORIGINS must contain at least one origin.")
        if any("*" in origin for origin in self.allowed_origins):
            raise RuntimeError("Wildcard CORS origins are not allowed.")
        for origin in self.allowed_origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise RuntimeError(
                    f"Invalid CORS origin {origin!r}; use an exact http(s) origin."
                )

    @property
    def model_dir(self) -> Path:
        return self.data_dir / "models"
