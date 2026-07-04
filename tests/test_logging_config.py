"""Tests para src/logging_config.py (rotación con archivado por fecha)."""

import logging

from src.logging_config import DatedRotatingFileHandler, setup_logging


def test_setup_logging_returns_root_logger():
    root = setup_logging()
    assert isinstance(root, logging.Logger)
    assert root.name == "root"


def test_setup_logging_skips_files_under_pytest():
    """Bajo pytest no debe crear handlers de archivo, solo consola."""
    root = setup_logging()
    file_handlers = [
        h for h in root.handlers if isinstance(h, DatedRotatingFileHandler)
    ]
    assert file_handlers == []


def test_dated_rotating_handler_archives_with_date(tmp_path):
    log_file = tmp_path / "demo.log"
    archive_dir = tmp_path / "archive"

    handler = DatedRotatingFileHandler(
        str(log_file),
        service_name="demo",
        archive_dir=str(archive_dir),
        maxBytes=10,
        backupCount=5,
        encoding="utf-8",
    )
    logger = logging.getLogger("test-dated-rotation-app")
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)

    logger.info("primera linea suficientemente larga para superar maxBytes")
    logger.info("segunda linea tambien larga para forzar otra rotacion")

    handler.close()

    archived = list(archive_dir.glob("demo_*.log"))
    assert len(archived) >= 1


def test_dated_rotating_handler_respects_backup_count(tmp_path):
    log_file = tmp_path / "demo.log"
    archive_dir = tmp_path / "archive"
    archive_dir.mkdir()

    for i in range(7):
        (archive_dir / f"demo_2026-01-0{i+1}_00-00-0{i}.log").write_text("x")

    handler = DatedRotatingFileHandler(
        str(log_file),
        service_name="demo",
        archive_dir=str(archive_dir),
        maxBytes=10,
        backupCount=3,
        encoding="utf-8",
    )
    handler._cleanup_old_archives()
    handler.close()

    remaining = list(archive_dir.glob("demo_*.log"))
    assert len(remaining) == 3
