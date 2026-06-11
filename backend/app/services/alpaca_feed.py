from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

NEW_YORK_TZ = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class MarketDataRoute:
    active_provider: str
    active_feed: str
    feed_state: str
    next_switch_time: datetime | None
    reason: str


def resolve_alpaca_feed(feed_mode: str, now: datetime | None = None) -> str:
    normalized = feed_mode.lower()
    if normalized in {"iex", "overnight"}:
        return normalized
    if normalized != "auto":
        raise ValueError("ALPACA_FEED_MODE must be one of auto, iex, overnight")

    current = now or datetime.now(NEW_YORK_TZ)
    current_et = current.astimezone(NEW_YORK_TZ)
    current_time = current_et.time()
    if current_time >= time(20, 0) or current_time < time(4, 0):
        return "overnight"
    return "iex"


def next_alpaca_feed_switch(feed_mode: str, now: datetime | None = None) -> datetime | None:
    if feed_mode.lower() != "auto":
        return None

    current = (now or datetime.now(NEW_YORK_TZ)).astimezone(NEW_YORK_TZ)
    today_4 = current.replace(hour=4, minute=0, second=0, microsecond=0)
    today_20 = current.replace(hour=20, minute=0, second=0, microsecond=0)
    if current < today_4:
        return today_4
    if current < today_20:
        return today_20
    return today_4 + timedelta(days=1)


def resolve_market_data_route(feed_mode: str, now: datetime | None = None) -> MarketDataRoute:
    normalized = feed_mode.lower()
    if normalized in {"iex", "overnight"}:
        return MarketDataRoute(
            active_provider="alpaca",
            active_feed=normalized,
            feed_state=f"forced_{normalized}",
            next_switch_time=None,
            reason=f"ALPACA_FEED_MODE={normalized}",
        )
    if normalized != "auto":
        raise ValueError("ALPACA_FEED_MODE must be one of auto, iex, overnight")

    current = (now or datetime.now(NEW_YORK_TZ)).astimezone(NEW_YORK_TZ)
    current_time = current.time()
    next_switch = _next_market_data_route_switch(current)
    if current_time >= time(20, 0) or current_time < time(4, 0):
        return MarketDataRoute(
            active_provider="alpaca",
            active_feed="overnight",
            feed_state="alpaca_overnight",
            next_switch_time=next_switch,
            reason="20:00-04:00 ET uses Alpaca overnight",
        )
    if time(4, 0) <= current_time < time(8, 0):
        return MarketDataRoute(
            active_provider="yahoo",
            active_feed="yahoo",
            feed_state="yahoo_gap_premarket",
            next_switch_time=next_switch,
            reason="04:00-08:00 ET Alpaca free feed gap uses Yahoo fallback",
        )
    if time(8, 0) <= current_time < time(17, 0):
        return MarketDataRoute(
            active_provider="alpaca",
            active_feed="iex",
            feed_state="alpaca_iex",
            next_switch_time=next_switch,
            reason="08:00-17:00 ET uses Alpaca IEX",
        )
    return MarketDataRoute(
        active_provider="yahoo",
        active_feed="yahoo",
        feed_state="yahoo_gap_afterhours",
        next_switch_time=next_switch,
        reason="17:00-20:00 ET Alpaca free feed gap uses Yahoo fallback",
    )


def _next_market_data_route_switch(current: datetime) -> datetime:
    checkpoints = [
        current.replace(hour=4, minute=0, second=0, microsecond=0),
        current.replace(hour=8, minute=0, second=0, microsecond=0),
        current.replace(hour=17, minute=0, second=0, microsecond=0),
        current.replace(hour=20, minute=0, second=0, microsecond=0),
    ]
    for checkpoint in checkpoints:
        if current < checkpoint:
            return checkpoint
    return checkpoints[0] + timedelta(days=1)
