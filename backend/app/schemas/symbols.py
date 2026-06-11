from pydantic import BaseModel, ConfigDict


class SymbolSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    symbol: str
    name: str | None
    exchange: str | None
    is_etf: bool | None
    source_file: str | None
