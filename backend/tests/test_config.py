import os
import unittest
from unittest.mock import patch

from app.core.config import get_settings


class ConfigTest(unittest.TestCase):
    def tearDown(self) -> None:
        get_settings.cache_clear()

    def test_market_data_settings_default_without_alpaca_credentials(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MARKET_DATA_PROVIDER": "alpaca",
                "ALPACA_API_KEY_ID": "",
                "ALPACA_API_SECRET_KEY": "",
            },
            clear=True,
        ):
            get_settings.cache_clear()

            settings = get_settings()

        self.assertEqual(settings.market_data_provider, "alpaca")
        self.assertEqual(settings.alpaca_api_key_id, "")
        self.assertEqual(settings.alpaca_api_secret_key, "")
        self.assertEqual(settings.alpaca_feed_mode, "auto")
        self.assertEqual(settings.alpaca_max_symbols, 30)

    def test_market_data_settings_read_from_environment(self) -> None:
        with patch.dict(
            os.environ,
            {
                "MARKET_DATA_PROVIDER": "ALPACA",
                "ALPACA_API_KEY_ID": "test-key-id",
                "ALPACA_API_SECRET_KEY": "test-secret-key",
                "ALPACA_FEED_MODE": "OVERNIGHT",
                "ALPACA_MAX_SYMBOLS": "12",
            },
            clear=True,
        ):
            get_settings.cache_clear()

            settings = get_settings()

        self.assertEqual(settings.market_data_provider, "alpaca")
        self.assertEqual(settings.alpaca_api_key_id, "test-key-id")
        self.assertEqual(settings.alpaca_api_secret_key, "test-secret-key")
        self.assertEqual(settings.alpaca_feed_mode, "overnight")
        self.assertEqual(settings.alpaca_max_symbols, 12)

    def test_market_data_feed_mode_rejects_unsupported_values(self) -> None:
        with patch.dict(os.environ, {"ALPACA_FEED_MODE": "sip"}, clear=True):
            get_settings.cache_clear()

            with self.assertRaisesRegex(ValueError, "Invalid ALPACA_FEED_MODE"):
                get_settings()


if __name__ == "__main__":
    unittest.main()
