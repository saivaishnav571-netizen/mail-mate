"""Runtime configuration security tests."""

from __future__ import annotations

import pytest

from backend.app.config import Settings


def test_runtime_requires_strong_admin_token():
    with pytest.raises(RuntimeError, match="MAILMATE_ADMIN_TOKEN"):
        Settings(admin_token=None).validate_runtime()

    with pytest.raises(RuntimeError, match="at least 32 characters"):
        Settings(admin_token="too-short").validate_runtime()


def test_runtime_rejects_wildcard_cors():
    settings = Settings(
        admin_token="a" * 32,
        allowed_origins=("https://example.com", "*"),
    )
    with pytest.raises(RuntimeError, match="Wildcard CORS"):
        settings.validate_runtime()


def test_runtime_rejects_non_origin_cors_values():
    settings = Settings(
        admin_token="a" * 32,
        allowed_origins=("https://example.com/admin",),
    )
    with pytest.raises(RuntimeError, match="exact http"):
        settings.validate_runtime()


def test_runtime_accepts_valid_settings():
    settings = Settings(
        admin_token="a" * 32,
        allowed_origins=("https://example.com",),
    )
    settings.validate_runtime()
