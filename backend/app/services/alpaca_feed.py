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

    # Auto mode is deliberately limited to the IEX feed included with Alpaca's
    # free Basic plan. Paid overnight access remains an explicit opt-in.
    return "iex"


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
    if current_time < time(8, 0):
        return MarketDataRoute(
            active_provider="yahoo",
            active_feed="yahoo",
            feed_state="yahoo_outside_iex_hours",
            next_switch_time=next_switch,
            reason="Before 08:00 ET uses Yahoo because auto mode is limited to free Alpaca IEX",
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
        feed_state="yahoo_outside_iex_hours",
        next_switch_time=next_switch,
        reason="After 17:00 ET uses Yahoo because auto mode is limited to free Alpaca IEX",
    )


def _next_market_data_route_switch(current: datetime) -> datetime:
    checkpoints = [
        current.replace(hour=8, minute=0, second=0, microsecond=0),
        current.replace(hour=17, minute=0, second=0, microsecond=0),
    ]
    for checkpoint in checkpoints:
        if current < checkpoint:
            return checkpoint
    return checkpoints[0] + timedelta(days=1)
