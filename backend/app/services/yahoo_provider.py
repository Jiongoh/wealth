from __future__ import annotations

import asyncio
import warnings
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

warnings.filterwarnings("ignore", message=".*Timestamp.utcnow.*", module=r"yfinance\..*")
warnings.filterwarnings("ignore", message=".*is deprecated.*", module=r"yfinance\..*")


@dataclass(frozen=True)
class YahooQuote:
    symbol: str
    last_price: Decimal
    bid_price: Decimal | None
    ask_price: Decimal | None
    source_timestamp: datetime
    data_source: str
    raw_payload: dict[str, Any]


@dataclass(frozen=True)
class YahooCandle:
    symbol: str
    timestamp: datetime
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None
    volume: Decimal | None
    raw_payload: dict[str, Any]


class YahooProviderUnavailable(RuntimeError):
    pass


class YahooMarketDataProvider:
    def __init__(self, *, timeout_seconds: float = 10.0) -> None:
        self.timeout_seconds = timeout_seconds

    async def fetch_latest_quotes(self, symbols: list[str]) -> list[YahooQuote]:
        if not symbols:
            return []
        return await asyncio.to_thread(self._fetch_latest_quotes_sync, symbols)

    async def fetch_latest_candles(self, symbols: list[str]) -> list[YahooCandle]:
        if not symbols:
            return []
        return await asyncio.to_thread(self._fetch_latest_candles_sync, symbols)

    def _fetch_latest_quotes_sync(self, symbols: list[str]) -> list[YahooQuote]:
        yf = _import_yfinance()
        with _suppress_yfinance_warnings():
            tickers = yf.Tickers(" ".join(symbols))
        rows: list[YahooQuote] = []
        for symbol in symbols:
            ticker = tickers.tickers.get(symbol) or yf.Ticker(symbol)
            raw = _safe_fast_info(ticker)
            price = None
            try:
                with _suppress_yfinance_warnings():
                    history = ticker.history(period="1d", interval="1m", prepost=True, timeout=self.timeout_seconds)
                if history is not None and not history.empty:
                    latest = history.dropna(subset=["Close"]).tail(1)
                    if not latest.empty:
                        price = _decimal_or_none(latest.iloc[0].get("Close"))
                        raw["history_timestamp"] = str(latest.index[-1])
            except Exception:
                price = None
            if price is None:
                price = _decimal_or_none(raw.get("last_price") or raw.get("lastPrice") or raw.get("regular_market_price"))
            if price is None:
                continue
            raw_timestamp = _timestamp_from_raw(raw)
            source_timestamp = raw_timestamp or datetime.now(UTC)
            data_source = "yahoo_poll" if raw_timestamp else "yahoo_poll_server_time"
            rows.append(
                YahooQuote(
                    symbol=symbol.upper(),
                    last_price=price,
                    bid_price=_decimal_or_none(raw.get("bid")),
                    ask_price=_decimal_or_none(raw.get("ask")),
                    source_timestamp=source_timestamp,
                    data_source=data_source,
                    raw_payload=_compact_raw(raw),
                )
            )
        return rows

    def _fetch_latest_candles_sync(self, symbols: list[str]) -> list[YahooCandle]:
        yf = _import_yfinance()
        rows: list[YahooCandle] = []
        for symbol in symbols:
            ticker = yf.Ticker(symbol)
            with _suppress_yfinance_warnings():
                history = ticker.history(period="1d", interval="1m", prepost=True, timeout=self.timeout_seconds)
            if history is None or history.empty:
                continue
            latest_rows = history.dropna(subset=["Close"]).tail(30)
            for timestamp, row in latest_rows.iterrows():
                candle_time = timestamp.to_pydatetime()
                if candle_time.tzinfo is None:
                    candle_time = candle_time.replace(tzinfo=UTC)
                rows.append(
                    YahooCandle(
                        symbol=symbol.upper(),
                        timestamp=candle_time.astimezone(UTC),
                        open=_decimal_or_none(row.get("Open")),
                        high=_decimal_or_none(row.get("High")),
                        low=_decimal_or_none(row.get("Low")),
                        close=_decimal_or_none(row.get("Close")),
                        volume=_decimal_or_none(row.get("Volume")),
                        raw_payload={
                            "_data_source": "yahoo_poll",
                            "source": "yfinance_history",
                            "symbol": symbol.upper(),
                        },
                    )
                )
        return rows


def _import_yfinance():
    try:
        import yfinance as yf
    except ImportError as exc:
        raise YahooProviderUnavailable("yfinance is not installed; Yahoo fallback disabled") from exc
    return yf


def _safe_fast_info(ticker) -> dict[str, Any]:
    try:
        with _suppress_yfinance_warnings():
            fast_info = ticker.fast_info
            if hasattr(fast_info, "items"):
                return dict(fast_info.items())
            return dict(fast_info)
    except Exception:
        return {}


def _timestamp_from_raw(raw: dict[str, Any]) -> datetime | None:
    value = raw.get("last_trade_time") or raw.get("lastTradeTime") or raw.get("regular_market_time")
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, (int, float)) and value > 0:
        return datetime.fromtimestamp(value, tz=UTC)
    history_timestamp = raw.get("history_timestamp")
    if isinstance(history_timestamp, str):
        try:
            parsed = datetime.fromisoformat(history_timestamp)
            return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def _decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        number = Decimal(str(value))
    except Exception:
        return None
    if not number.is_finite():
        return None
    return number if number > 0 else None


def _compact_raw(raw: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "currency",
        "exchange",
        "last_price",
        "lastPrice",
        "regular_market_price",
        "regular_market_time",
        "last_trade_time",
        "lastTradeTime",
        "bid",
        "ask",
        "history_timestamp",
        "previous_close",
        "previousClose",
        "regularMarketPreviousClose",
    }
    payload: dict[str, Any] = {"_data_source": "yahoo_poll", "source": "yfinance"}
    for key in allowed:
        value = raw.get(key)
        if isinstance(value, datetime):
            payload[key] = value.isoformat()
        elif isinstance(value, (str, int, float, bool)) or value is None:
            payload[key] = value
    return payload


@contextmanager
def _suppress_yfinance_warnings():
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=".*Timestamp.utcnow.*")
        warnings.filterwarnings("ignore", message=".*is deprecated.*")
        yield
