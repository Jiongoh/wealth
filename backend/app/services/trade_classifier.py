import re

from app.models import Trade

FX_ASSET_CLASSES = {"CASH", "FX", "FOREX", "CURRENCY", "CURR"}
FX_SYMBOL_PATTERN = re.compile(r"^[A-Z]{3}\.[A-Z]{3}$")


def is_fx_conversion_trade(trade: Trade) -> bool:
    asset_class = (trade.asset_class or "").strip().upper()
    if asset_class in FX_ASSET_CLASSES:
        return True
    if any(token in asset_class for token in ("FOREX", "CURRENCY")):
        return True

    symbol = (trade.symbol or "").strip().upper()
    return bool(FX_SYMBOL_PATTERN.fullmatch(symbol))


def is_fx_conversion_record(record: dict) -> bool:
    asset_class = str(record.get("asset_class") or "").strip().upper()
    if asset_class in FX_ASSET_CLASSES:
        return True
    if any(token in asset_class for token in ("FOREX", "CURRENCY")):
        return True

    symbol = str(record.get("symbol") or "").strip().upper()
    return bool(FX_SYMBOL_PATTERN.fullmatch(symbol))
