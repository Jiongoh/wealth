import time
import xml.etree.ElementTree as ET
from datetime import date

import httpx

from app.core.config import Settings

RETRYABLE_ERROR_CODES = {
    "1001",
    "1003",
    "1004",
    "1005",
    "1006",
    "1007",
    "1008",
    "1009",
    "1018",
    "1019",
    "1021",
}


class IBKRFlexError(Exception):
    pass


class IBKRFlexClient:
    def __init__(self, settings: Settings) -> None:
        self.token = settings.ibkr_token
        self.query_id = settings.ibkr_query_id
        self.send_request_url, self.get_statement_url = _resolve_endpoint_urls(
            settings.ibkr_flex_url
        )
        self.version = settings.ibkr_flex_version
        self.timeout = settings.ibkr_request_timeout_seconds
        self.poll_seconds = settings.ibkr_statement_poll_seconds
        self.poll_attempts = settings.ibkr_statement_poll_attempts

    def download_xml(
        self, *, from_date: date | None = None, to_date: date | None = None
    ) -> bytes:
        self._validate_configuration()
        if (from_date is None) != (to_date is None):
            raise IBKRFlexError("Both from_date and to_date are required for a historical request")
        if from_date is not None and (to_date < from_date or (to_date - from_date).days >= 365):
            raise IBKRFlexError("Historical request must cover 1 to 365 calendar days")
        reference_code = self._request_reference_code(from_date=from_date, to_date=to_date)

        for attempt in range(self.poll_attempts):
            if self.poll_seconds:
                time.sleep(self.poll_seconds)

            statement_xml = self._get(self.get_statement_url, "GetStatement", reference_code)
            response_error = _response_error(statement_xml)
            if response_error is None:
                return statement_xml

            code, message = response_error
            if code not in RETRYABLE_ERROR_CODES or attempt == self.poll_attempts - 1:
                raise IBKRFlexError(f"IBKR GetStatement failed: {code} {message}".strip())

        raise IBKRFlexError("IBKR statement download attempts exhausted")

    def _validate_configuration(self) -> None:
        missing = []
        if not self.token:
            missing.append("IBKR_TOKEN")
        if not self.query_id:
            missing.append("IBKR_QUERY_ID")
        if not self.send_request_url:
            missing.append("IBKR_FLEX_URL")
        if missing:
            raise IBKRFlexError(f"Missing IBKR configuration: {', '.join(missing)}")
        if self.poll_attempts < 1:
            raise IBKRFlexError("IBKR_STATEMENT_POLL_ATTEMPTS must be at least 1")

    def _request_reference_code(
        self, *, from_date: date | None = None, to_date: date | None = None
    ) -> str:
        extra_params = (
            {"fd": from_date.strftime("%Y%m%d"), "td": to_date.strftime("%Y%m%d")}
            if from_date is not None and to_date is not None
            else None
        )
        response_xml = self._get(
            self.send_request_url, "SendRequest", self.query_id, extra_params=extra_params
        )
        response_error = _response_error(response_xml)
        if response_error is not None:
            code, message = response_error
            raise IBKRFlexError(f"IBKR SendRequest failed: {code} {message}".strip())

        root = _parse_xml(response_xml)
        reference_code = root.findtext("ReferenceCode")
        if not reference_code:
            raise IBKRFlexError("IBKR SendRequest response did not include a reference code")
        return reference_code

    def _get(
        self, url: str, operation: str, query_id: str, *, extra_params: dict[str, str] | None = None
    ) -> bytes:
        params = {"t": self.token, "q": query_id, "v": self.version}
        if extra_params:
            params.update(extra_params)
        try:
            response = httpx.get(
                url,
                params=params,
                headers={"User-Agent": "ibkr-sync/0.1.0"},
                timeout=self.timeout,
                follow_redirects=True,
            )
            response.raise_for_status()
        except httpx.HTTPError:
            raise IBKRFlexError(f"IBKR {operation} HTTP request failed") from None

        return response.content


def _resolve_endpoint_urls(url: str) -> tuple[str, str]:
    endpoint = url.rstrip("/")
    for suffix, replacement in (
        (".SendRequest", ".GetStatement"),
        (".GetStatement", ".SendRequest"),
        ("/SendRequest", "/GetStatement"),
        ("/GetStatement", "/SendRequest"),
    ):
        if endpoint.endswith(suffix):
            peer = f"{endpoint[:-len(suffix)]}{replacement}"
            return (endpoint, peer) if "SendRequest" in suffix else (peer, endpoint)
    if not endpoint:
        return "", ""
    return f"{endpoint}/SendRequest", f"{endpoint}/GetStatement"


def _parse_xml(content: bytes) -> ET.Element:
    try:
        return ET.fromstring(content)
    except ET.ParseError as exc:
        raise IBKRFlexError("IBKR response was not valid XML") from exc


def _response_error(content: bytes) -> tuple[str, str] | None:
    root = _parse_xml(content)
    if root.tag != "FlexStatementResponse":
        return None
    if root.findtext("Status") == "Success":
        return None
    return root.findtext("ErrorCode", "unknown"), root.findtext("ErrorMessage", "")
