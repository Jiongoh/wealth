"""Shared, environment-independent constants.

Keeping these in one module avoids the same magic number drifting across the
config loader, the market-data worker, and the subscription planner.
"""

# Alpaca's free market-data tier allows at most this many symbols to be
# subscribed on a single websocket connection. It is the single source of
# truth for the cap: the API config default, the worker default, and the
# subscription planner all derive from it, and the ALPACA_MAX_SYMBOLS env var
# can lower it (never raise it past what the plan allows) for local testing.
ALPACA_FREE_MAX_SYMBOLS = 30
