import os
from dataclasses import dataclass
from functools import lru_cache

from app.core.constants import ALPACA_FREE_MAX_SYMBOLS


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _get_lower_choice(name: str, default: str, choices: set[str]) -> str:
    value = os.getenv(name, default).lower()
    if value not in choices:
        expected = ", ".join(sorted(choices))
        raise ValueError(f"Invalid {name}: expected one of {expected}")
    return value


def _get_bool(name: str, default: bool) -> bool:
    fallback = "true" if default else "false"
    return os.getenv(name, fallback).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_version: str
    log_level: str
    cors_origins: list[str]
    database_url: str
    raw_xml_dir: str
    app_timezone: str
    ibkr_token: str
    ibkr_query_id: str
    ibkr_flex_url: str
    ibkr_flex_version: str
    ibkr_request_timeout_seconds: float
    ibkr_statement_poll_seconds: float
    ibkr_statement_poll_attempts: int
    sync_cron_hour: int
    sync_cron_minute: int
    enable_sync_scheduler: bool = True
    market_data_provider: str = ""
    alpaca_api_key_id: str = ""
    alpaca_api_secret_key: str = ""
    alpaca_feed_mode: str = "auto"
    alpaca_max_symbols: int = ALPACA_FREE_MAX_SYMBOLS
    yahoo_fallback_enabled: bool = True
    yahoo_fallback_mode: str = "auto"
    yahoo_fallback_interval_seconds: int = 15
    yahoo_fallback_max_symbols: int = ALPACA_FREE_MAX_SYMBOLS
    yahoo_fallback_write_candles: bool = True
    yahoo_fallback_timeout_seconds: float = 10.0
    market_data_retention_minutes: int = 60
    market_data_cleanup_interval_seconds: int = 300
    market_data_status_retention_days: int = 7


@lru_cache
def get_settings() -> Settings:
    return Settings(
        app_name=os.getenv("APP_NAME", "ibkr-sync"),
        app_version=os.getenv("APP_VERSION", "0.1.0"),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        cors_origins=_split_csv(
            os.getenv(
                "CORS_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            )
        ),
        database_url=os.getenv("DATABASE_URL", ""),
        raw_xml_dir=os.getenv("RAW_XML_DIR", "/app/storage/raw_xml"),
        app_timezone=os.getenv("APP_TIMEZONE", "Asia/Taipei"),
        ibkr_token=os.getenv("IBKR_TOKEN", ""),
        ibkr_query_id=os.getenv("IBKR_QUERY_ID", ""),
        ibkr_flex_url=os.getenv("IBKR_FLEX_URL", ""),
        ibkr_flex_version=os.getenv("IBKR_FLEX_VERSION", "3"),
        ibkr_request_timeout_seconds=float(os.getenv("IBKR_REQUEST_TIMEOUT_SECONDS", "30")),
        ibkr_statement_poll_seconds=float(os.getenv("IBKR_STATEMENT_POLL_SECONDS", "5")),
        ibkr_statement_poll_attempts=int(os.getenv("IBKR_STATEMENT_POLL_ATTEMPTS", "5")),
        sync_cron_hour=int(os.getenv("SYNC_CRON_HOUR", "8")),
        sync_cron_minute=int(os.getenv("SYNC_CRON_MINUTE", "30")),
        enable_sync_scheduler=_get_bool("ENABLE_SYNC_SCHEDULER", True),
        market_data_provider=os.getenv("MARKET_DATA_PROVIDER", "").lower(),
        alpaca_api_key_id=os.getenv("ALPACA_API_KEY_ID", ""),
        alpaca_api_secret_key=os.getenv("ALPACA_API_SECRET_KEY", ""),
        alpaca_feed_mode=_get_lower_choice(
            "ALPACA_FEED_MODE",
            "auto",
            {"auto", "iex", "overnight"},
        ),
        alpaca_max_symbols=int(os.getenv("ALPACA_MAX_SYMBOLS", str(ALPACA_FREE_MAX_SYMBOLS))),
        yahoo_fallback_enabled=_get_bool("YAHOO_FALLBACK_ENABLED", True),
        yahoo_fallback_mode=os.getenv("YAHOO_FALLBACK_MODE", "auto").lower(),
        yahoo_fallback_interval_seconds=int(os.getenv("YAHOO_FALLBACK_INTERVAL_SECONDS", "15")),
        yahoo_fallback_max_symbols=int(os.getenv("YAHOO_FALLBACK_MAX_SYMBOLS", str(ALPACA_FREE_MAX_SYMBOLS))),
        yahoo_fallback_write_candles=_get_bool("YAHOO_FALLBACK_WRITE_CANDLES", True),
        yahoo_fallback_timeout_seconds=float(os.getenv("YAHOO_FALLBACK_TIMEOUT_SECONDS", "10")),
        market_data_retention_minutes=int(os.getenv("MARKET_DATA_RETENTION_MINUTES", "60")),
        market_data_cleanup_interval_seconds=int(os.getenv("MARKET_DATA_CLEANUP_INTERVAL_SECONDS", "300")),
        market_data_status_retention_days=int(os.getenv("MARKET_DATA_STATUS_RETENTION_DAYS", "7")),
    )
