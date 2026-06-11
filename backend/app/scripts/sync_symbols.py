import argparse

from app.db.session import get_session_factory
from app.services.symbol_directory_sync import DEFAULT_SYMBOL_CSV_PATH, SymbolDirectorySyncService


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the local US symbol directory CSV.")
    parser.add_argument("--file", default=DEFAULT_SYMBOL_CSV_PATH, help="Path to normalized US symbols CSV")
    args = parser.parse_args()

    with get_session_factory()() as db:
        result = SymbolDirectorySyncService().import_from_csv(db, args.file)

    print(
        "symbol_directory_sync "
        f"sync_run_id={result.sync_run_id} "
        f"status={result.status} "
        f"rows_total={result.rows_total} "
        f"rows_inserted={result.rows_inserted} "
        f"rows_updated={result.rows_updated} "
        f"artifact_path={result.artifact_path}"
    )
    if result.error_message:
        raise SystemExit(result.error_message)


if __name__ == "__main__":
    main()
