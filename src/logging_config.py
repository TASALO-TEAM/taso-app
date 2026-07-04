"""Sistema de logging con rotación por tamaño y archivado por fecha (TASALO-App).

Misma estrategia que taso-api (ver ese repo para más contexto). Se duplica aquí
porque taso-app y taso-api son repos independientes sin paquete compartido.

Logs activos (siempre en `logs/`):
    logs/taso-app.log          -> todo el log, nivel DEBUG+ (INFO+ en consola)
    logs/taso-app-errors.log   -> solo ERROR+, retención igual pero aislado

Logs archivados (al rotar por tamaño, no se usan sufijos numéricos):
    logs/archive/taso-app_<YYYY-MM-DD_HH-MM-SS>.log
    logs/archive/taso-app-errors_<YYYY-MM-DD_HH-MM-SS>.log

`setup_logging()` no crea archivos si detecta que corre bajo pytest
(`PYTEST_CURRENT_TEST` en el entorno), para no ensuciar el repo durante los tests.
"""

import logging
import os
import sys
import time
from logging.handlers import RotatingFileHandler

SERVICE_NAME = "taso-app"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(BASE_DIR, "logs")
ARCHIVE_DIR = os.path.join(LOGS_DIR, "archive")
LOG_FILE_PATH = os.path.join(LOGS_DIR, f"{SERVICE_NAME}.log")
ERROR_LOG_PATH = os.path.join(LOGS_DIR, f"{SERVICE_NAME}-errors.log")

MAX_BYTES = 5 * 1024 * 1024  # 5 MB por archivo activo antes de rotar
BACKUP_COUNT = 10  # tope de seguridad de archivos rotados por log (además de /log clear)

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _running_under_pytest() -> bool:
    return "PYTEST_CURRENT_TEST" in os.environ


class DatedRotatingFileHandler(RotatingFileHandler):
    """RotatingFileHandler que archiva por fecha de cierre en vez de sufijo numérico.

    Al superar `maxBytes`, el archivo activo se cierra y se mueve a
    `<archive_dir>/<service_name>_<timestamp>.log`. Se mantiene como máximo
    `backupCount` archivos por servicio en el directorio de archivo; los más
    viejos se eliminan automáticamente.
    """

    def __init__(
        self,
        filename: str,
        service_name: str,
        archive_dir: str | None = None,
        maxBytes: int = 0,
        backupCount: int = 0,
        encoding: str | None = None,
        delay: bool = False,
    ):
        self.service_name = service_name
        base_dir = os.path.dirname(os.path.abspath(filename))
        self.archive_dir = archive_dir or os.path.join(base_dir, "archive")
        os.makedirs(self.archive_dir, exist_ok=True)
        super().__init__(
            filename,
            maxBytes=maxBytes,
            backupCount=backupCount,
            encoding=encoding,
            delay=delay,
        )

    def doRollover(self):
        if self.stream:
            self.stream.close()
            self.stream = None

        if os.path.exists(self.baseFilename):
            archive_name = self._build_archive_name()
            try:
                os.rename(self.baseFilename, archive_name)
            except OSError:
                pass

        self._cleanup_old_archives()

        if not self.delay:
            self.stream = self._open()

    def _build_archive_name(self) -> str:
        timestamp = time.strftime("%Y-%m-%d_%H-%M-%S")
        candidate = os.path.join(self.archive_dir, f"{self.service_name}_{timestamp}.log")
        counter = 1
        while os.path.exists(candidate):
            candidate = os.path.join(
                self.archive_dir, f"{self.service_name}_{timestamp}_{counter}.log"
            )
            counter += 1
        return candidate

    def _cleanup_old_archives(self):
        if self.backupCount <= 0:
            return
        try:
            prefix = f"{self.service_name}_"
            archives = sorted(
                (
                    f
                    for f in os.listdir(self.archive_dir)
                    if f.startswith(prefix) and f.endswith(".log")
                ),
                key=lambda f: os.path.getmtime(os.path.join(self.archive_dir, f)),
            )
            excess = len(archives) - self.backupCount
            for old_file in archives[: max(0, excess)]:
                os.remove(os.path.join(self.archive_dir, old_file))
        except OSError:
            pass


def setup_logging(level: int = logging.INFO) -> logging.Logger:
    """Configura el logger raíz de taso-app: consola + archivo rotado + errores.

    Args:
        level: nivel mínimo para la consola (el archivo captura DEBUG+ siempre).

    Returns:
        El logger raíz ya configurado.
    """
    root_logger = logging.getLogger()
    root_logger.handlers = []
    root_logger.setLevel(logging.DEBUG)

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(level)
    root_logger.addHandler(console_handler)

    if _running_under_pytest():
        # Evita crear logs/ y logs/archive/ durante los tests.
        return root_logger

    os.makedirs(LOGS_DIR, exist_ok=True)

    file_handler = DatedRotatingFileHandler(
        LOG_FILE_PATH,
        service_name=SERVICE_NAME,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.DEBUG)
    root_logger.addHandler(file_handler)

    error_handler = DatedRotatingFileHandler(
        ERROR_LOG_PATH,
        service_name=f"{SERVICE_NAME}-errors",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    error_handler.setFormatter(formatter)
    error_handler.setLevel(logging.ERROR)
    root_logger.addHandler(error_handler)

    root_logger.info("✅ Logging de archivo habilitado: %s", LOG_FILE_PATH)
    root_logger.info("✅ Logging de errores habilitado: %s", ERROR_LOG_PATH)

    return root_logger
