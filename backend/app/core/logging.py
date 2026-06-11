import logging
import sys


def configure_logging(log_level: str) -> None:
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
        force=True,
    )
    # HTTP client request URLs include the IBKR token as a query parameter.
    logging.getLogger("httpx").disabled = True
    logging.getLogger("httpcore").disabled = True
