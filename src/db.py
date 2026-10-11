"""SQLite propia de la app (S10): alertas de precio cripto y uso de monedas para el top 5 de Mercado.

Sin dependencias nuevas (``sqlite3`` de la biblioteca estándar). Cada operación abre su propia conexión (WAL,
autocommit): así es seguro entre el hilo del checker y los hilos de las peticiones. ``settings.db_path`` es relativo
a la raíz del proyecto; los tests lo apuntan a un archivo temporal.

Lo que se guarda de una alerta es lo mínimo para disparar bien: usuario, moneda (con sus identificadores exactos en
cada fuente, no solo el símbolo), precio objetivo, dirección, estado y fechas. NO hay historial de precios.
"""

from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Iterator

from config import settings

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCHEMA = """
CREATE TABLE IF NOT EXISTS price_alerts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL,
    symbol            TEXT    NOT NULL,
    binance_pair      TEXT,
    cmc_id            INTEGER,
    cg_id             TEXT,
    target            REAL    NOT NULL,
    direction         TEXT    NOT NULL CHECK (direction IN ('ABOVE', 'BELOW')),
    status            TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIGGERED')),
    price_at_creation REAL,
    created_at        TEXT    NOT NULL,
    last_checked_at   TEXT,
    pending_hits      INTEGER NOT NULL DEFAULT 0,
    triggered_at      TEXT,
    triggered_price   REAL,
    trigger_kind      TEXT,
    trigger_source    TEXT,
    notified          INTEGER NOT NULL DEFAULT 0,
    notify_attempts   INTEGER NOT NULL DEFAULT 0,
    notify_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON price_alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON price_alerts (user_id, status);

CREATE TABLE IF NOT EXISTS coin_queries (
    user_id INTEGER NOT NULL,
    symbol  TEXT    NOT NULL,
    day     TEXT    NOT NULL,
    PRIMARY KEY (user_id, symbol, day)
);
CREATE INDEX IF NOT EXISTS idx_queries_day ON coin_queries (day);

CREATE TABLE IF NOT EXISTS coin_ticks (
    coin_key TEXT PRIMARY KEY,
    price    REAL NOT NULL,
    at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lease (
    name       TEXT PRIMARY KEY,
    holder     TEXT NOT NULL,
    expires_at REAL NOT NULL
);
"""


def db_file() -> str:
    path = settings.db_path
    if not os.path.isabs(path):
        path = os.path.join(ROOT, path)
    return path


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_ready: set[str] = set()
_ready_lock = threading.Lock()


@contextlib.contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """Conexión nueva en autocommit (usa ``BEGIN IMMEDIATE`` para bloques atómicos).

    La primera vez que se usa cada archivo crea las tablas que falten (idempotente), así que no hace falta
    llamar a ``init_db()`` al arrancar.
    """
    path = db_file()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=10000")
        if path not in _ready:
            with _ready_lock:
                if path not in _ready:
                    conn.executescript(SCHEMA)
                    _ready.add(path)
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Crea las tablas si no existen (idempotente; se llama al arrancar y en los tests)."""
    with connect() as conn:
        conn.executescript(SCHEMA)
