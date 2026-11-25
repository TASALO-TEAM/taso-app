"""Revisión periódica de las alertas de precio propias y aviso por el bot (S10 F4, paso 2).

Un hilo de fondo (``start()``), con candado en la base (``db.try_lease``) para que nunca corran dos, ejecuta cada
``PRICE_CHECK_INTERVAL_SECONDS`` un ciclo (``run_cycle``):

1. Lee el precio de las monedas con alertas activas, sin repetir (``crypto.fetch_primary``: Binance → CMC → CoinGecko).
2. Descarta lecturas inválidas y saltos de más del 25 % respecto a la última lectura válida que no confirme otra fuente.
3. Una alerta «llega» (a menos de 0,1 % del objetivo) o «se pasa» (lo superó). Para disparar, una segunda fuente
   distinta debe coincidir con la primera (±1,5 %); si no hay segunda fuente, hacen falta dos revisiones seguidas.
4. En monedas de Binance también mira las velas de 5 min desde la última revisión (mechas entre ciclos).
5. El disparo es atómico (``UPDATE … WHERE status='ACTIVE'``): solo quien cambia la fila avisa. El aviso sale por el
   bot (``sendMessage`` con el mismo token) y se reintenta hasta 6 ciclos; si el usuario bloqueó el bot se deja
   marcada («disparada, sin aviso») y no se insiste.

Lo que no se pudo leer en un ciclo NO actualiza ``last_checked_at``: así las velas del siguiente ciclo cubren el hueco.
"""

from __future__ import annotations

import html
import logging
import math
import os
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

import httpx

from config import settings
from src import db
from src.services import crypto
from src.services.crypto import Candle, CoinRef, Reading

logger = logging.getLogger("taso-miniapp.alerts-checker")

TOUCH_TOL = 0.001          # «llegó»: a menos de 0,1 % del objetivo
CONFIRM_PCT = 0.015        # dos fuentes deben coincidir dentro del 1,5 %
JUMP_PCT = 0.25            # un salto mayor respecto a la última lectura válida necesita confirmación
WICK_MAX_DEV = 0.25        # una mecha a más de 25 % del precio actual se considera dato raro
TICK_MAX_AGE = 3600.0      # una lectura anterior de más de 1 h ya no sirve para medir saltos
CANDLE_SECONDS = 300       # velas de 5 min
MAX_NOTIFY_ATTEMPTS = 6
FLUSH_LIMIT = 50           # avisos por ciclo
LEASE_NAME = "price-checker"
TELEGRAM_API = "https://api.telegram.org"
SEND_TIMEOUT = 10.0

_stop = threading.Event()
_thread: Optional[threading.Thread] = None
_holder = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------- utilidades puras

def _parse_iso(value: Any) -> Optional[datetime]:
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _valid_price(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0


def _agrees(a: float, b: float) -> bool:
    return abs(a - b) / a <= CONFIRM_PCT


def spot_hit(direction: str, target: float, price: float) -> Optional[str]:
    """``'passed'`` si el precio ya superó el objetivo, ``'reached'`` si está a menos de 0,1 %, ``None`` si no llegó."""
    if direction == "ABOVE":
        if price > target:
            return "passed"
        if price >= target * (1 - TOUCH_TOL):
            return "reached"
    else:
        if price < target:
            return "passed"
        if price <= target * (1 + TOUCH_TOL):
            return "reached"
    return None


def fmt_price(value: Any) -> str:
    """Precio legible: miles con coma y 2 decimales desde 1; por debajo de 1, cifras significativas suficientes."""
    if not _valid_price(value):
        return "?"
    if value >= 1000:
        return f"{value:,.2f}"
    if value >= 1:
        return f"{value:,.4f}".rstrip("0").rstrip(".")
    digits = min(12, max(2, 3 - math.floor(math.log10(value))))
    return f"{value:.{digits}f}".rstrip("0").rstrip(".")


def _cuba_time(iso: Any) -> str:
    moment = _parse_iso(iso)
    if moment is None:
        return "?"
    try:
        from zoneinfo import ZoneInfo

        return moment.astimezone(ZoneInfo("America/Havana")).strftime("%H:%M") + " (hora de Cuba)"
    except Exception:  # sin base de zonas horarias en el sistema
        return moment.strftime("%H:%M") + " UTC"


def build_message(row: Any) -> str:
    """Texto del aviso (HTML de Telegram; todo lo dinámico va escapado)."""
    above = row["direction"] == "ABOVE"
    symbol = html.escape(str(row["symbol"]))
    target = fmt_price(row["target"])
    got = fmt_price(row["triggered_price"])
    kind = row["trigger_kind"]
    if kind == "wick":
        verb = "subió hasta" if above else "bajó hasta"
        body = f"{symbol} {verb} ${got} alrededor de las {_cuba_time(row['triggered_at'])} y tocó tu objetivo de ${target}."
    elif kind == "passed":
        verb = "superó" if above else "cayó por debajo de"
        body = f"{symbol} {verb} tu objetivo de ${target}. Ahora está en ${got}."
    else:
        body = f"{symbol} llegó a ${got}, junto a tu objetivo de ${target}."
    arrow = "\U0001F4C8" if above else "\U0001F4C9"  # sin barra invertida dentro del f-string: Python 3.11 del VPS no lo admite
    lines = ["\U0001F514 <b>Alerta de precio</b>", f"{arrow} {body}"]
    start = row["price_at_creation"]
    if _valid_price(start) and _valid_price(row["triggered_price"]):
        pct = (row["triggered_price"] - start) / start * 100
        lines.append(f"{pct:+.1f} % desde que creaste la alerta.")
    seen = _parse_iso(row["last_checked_at"])
    fired = _parse_iso(row["triggered_at"])
    if kind != "wick" and seen and fired and (fired - seen).total_seconds() > 3 * max(settings.price_check_interval_seconds, 60):
        lines.append("Ocurrió mientras la revisión estaba en pausa.")
    return "\n".join(lines)


# ---------------------------------------------------------------- envío por el bot

def send_message(chat_id: int, text: str) -> tuple[bool, str, bool]:
    """Envía el aviso con el bot. Devuelve ``(enviado, detalle, permanente)``; ``permanente`` = no vale la pena reintentar."""
    token = settings.telegram_bot_token
    if not token:
        return False, "sin token", False
    payload: dict[str, Any] = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if settings.miniapp_url:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "Abrir alertas", "web_app": {"url": settings.miniapp_url}}]]}
    try:
        resp = httpx.post(f"{TELEGRAM_API}/bot{token}/sendMessage", json=payload, timeout=SEND_TIMEOUT)
    except httpx.HTTPError as exc:  # solo el tipo: el mensaje de algunos errores incluye la URL (y con ella el token)
        return False, f"red: {type(exc).__name__}", False
    if resp.status_code == 200:
        return True, "", False
    try:
        description = str(resp.json().get("description", ""))
    except ValueError:
        description = ""
    permanent = resp.status_code == 403 or (resp.status_code == 400 and "chat not found" in description.lower())
    return False, f"http {resp.status_code}: {description}"[:180], permanent


def _flush_notifications() -> int:
    """Avisa de las alertas disparadas que aún no se han avisado. Devuelve cuántos avisos salieron."""
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT * FROM price_alerts WHERE status='TRIGGERED' AND notified=0 AND notify_attempts < ? "
            "AND (notify_error IS NULL OR notify_error NOT LIKE 'blocked%') ORDER BY id LIMIT ?",
            (MAX_NOTIFY_ATTEMPTS, FLUSH_LIMIT),
        ).fetchall()
    sent = 0
    for row in rows:
        with db.connect() as conn:  # «reclamo»: solo quien suma el intento envía (nunca dos avisos de la misma alerta)
            claim = conn.execute(
                "UPDATE price_alerts SET notify_attempts = notify_attempts + 1 WHERE id=? AND notified=0 AND notify_attempts=?",
                (row["id"], row["notify_attempts"]),
            )
        if claim.rowcount != 1:
            continue
        ok, detail, permanent = send_message(row["user_id"], build_message(row))
        with db.connect() as conn:
            if ok:
                conn.execute("UPDATE price_alerts SET notified=1, notify_error=NULL WHERE id=?", (row["id"],))
                sent += 1
            else:
                label = ("blocked: " if permanent else "retry: ") + detail
                conn.execute("UPDATE price_alerts SET notify_error=? WHERE id=?", (label[:200], row["id"]))
                logger.warning("aviso de la alerta %s no enviado (intento %s): %s", row["id"], row["notify_attempts"] + 1, detail)
    return sent


# ---------------------------------------------------------------- un ciclo

def _confirmer() -> Callable[[CoinRef, str], Optional[Reading]]:
    """Segunda fuente por moneda, consultada como mucho una vez por ciclo."""
    cache: dict[str, Optional[Reading]] = {}

    def confirm(ref: CoinRef, source: str) -> Optional[Reading]:
        if ref.key not in cache:
            try:
                other = crypto.fetch_confirmation(ref, source)
            except Exception:
                logger.warning("no se pudo pedir la segunda fuente de %s", ref.symbol, exc_info=True)
                other = None
            cache[ref.key] = other if other is not None and _valid_price(other.price) else None
        return cache[ref.key]

    return confirm


def _accept(ref: CoinRef, reading: Reading, now: datetime, confirm) -> bool:
    """Descarta saltos bruscos sin confirmar; si la lectura vale, queda como última lectura válida de la moneda."""
    with db.connect() as conn:
        tick = conn.execute("SELECT price, at FROM coin_ticks WHERE coin_key=?", (ref.key,)).fetchone()
    seen = _parse_iso(tick["at"]) if tick else None
    if tick and seen and (now - seen).total_seconds() <= TICK_MAX_AGE and _valid_price(tick["price"]):
        jump = abs(reading.price - tick["price"]) / tick["price"]
        if jump > JUMP_PCT:
            other = confirm(ref, reading.source)
            if other is None or not _agrees(reading.price, other.price):
                logger.warning("salto de %.0f %% en %s sin confirmar (%.8g → %.8g): lectura descartada",
                               jump * 100, ref.symbol, tick["price"], reading.price)
                return False
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO coin_ticks (coin_key, price, at) VALUES (?,?,?) "
            "ON CONFLICT(coin_key) DO UPDATE SET price=excluded.price, at=excluded.at",
            (ref.key, reading.price, _iso(now)),
        )
    return True


def _touch(alert_id: int, now: datetime, pending: int) -> None:
    with db.connect() as conn:
        conn.execute(
            "UPDATE price_alerts SET last_checked_at=?, pending_hits=? WHERE id=? AND status='ACTIVE'",
            (_iso(now), pending, alert_id),
        )


def _trigger(alert_id: int, kind: str, price: float, source: str, at_iso: str) -> bool:
    """Disparo atómico: True solo si ESTA llamada cambió la fila (quien lo logra es quien avisa)."""
    with db.connect() as conn:
        cur = conn.execute(
            "UPDATE price_alerts SET status='TRIGGERED', triggered_at=?, triggered_price=?, trigger_kind=?, "
            "trigger_source=?, pending_hits=0 WHERE id=? AND status='ACTIVE'",
            (at_iso, price, kind, source, alert_id),
        )
    if cur.rowcount == 1:
        logger.info("alerta %s disparada (%s) a %.8g", alert_id, kind, price)
    return cur.rowcount == 1


def _candles(ref: CoinRef, rows: list, now: datetime) -> list[Candle]:
    if not ref.binance_pair:
        return []
    starts = [_parse_iso(r["last_checked_at"]) or _parse_iso(r["created_at"]) or now for r in rows]
    since = min(starts) - timedelta(seconds=CANDLE_SECONDS)
    try:
        return crypto.binance_candles(ref.binance_pair, since)
    except Exception:
        logger.warning("no se pudieron leer las velas de %s", ref.binance_pair, exc_info=True)
        return []


def _find_wick(row: Any, candles: list[Candle], price: float) -> Optional[tuple[Candle, float]]:
    """Primera vela, posterior a la creación, cuyo máximo (o mínimo) tocó el objetivo. Ignora mechas absurdas."""
    created = _parse_iso(row["created_at"])
    seen = _parse_iso(row["last_checked_at"]) or created
    floor = seen - timedelta(seconds=CANDLE_SECONDS) if seen else None  # incluye la vela que cruzaba la última revisión
    above = row["direction"] == "ABOVE"
    for candle in candles:
        if created and candle.open_time < created:  # empezó antes de existir la alerta: no vale
            continue
        if floor and candle.open_time < floor:
            continue
        extreme = candle.high if above else candle.low
        touched = extreme >= row["target"] * (1 - TOUCH_TOL) if above else extreme <= row["target"] * (1 + TOUCH_TOL)
        if not touched:
            continue
        if abs(extreme - price) / price > WICK_MAX_DEV:
            logger.warning("mecha de %.8g descartada: a más de 25 %% del precio actual (%.8g)", extreme, price)
            continue
        return candle, extreme
    return None


def _evaluate_coin(ref: CoinRef, rows: list, reading: Reading, now: datetime, confirm) -> int:
    price = reading.price
    fired = 0
    waiting = []  # sin cruce al contado: pueden haber tocado el objetivo con una mecha
    for row in rows:
        kind = spot_hit(row["direction"], row["target"], price)
        if kind is None:
            waiting.append(row)
            continue
        other = confirm(ref, reading.source)
        if other is not None and not _agrees(price, other.price):
            logger.warning("discrepancia en %s: %s %.8g vs %s %.8g; no se dispara", ref.symbol,
                           reading.source, price, other.source, other.price)
            _touch(row["id"], now, 0)
            continue
        if other is None and row["pending_hits"] < 1:  # sin segunda fuente: hace falta una segunda revisión seguida
            _touch(row["id"], now, row["pending_hits"] + 1)
            continue
        if _trigger(row["id"], kind, price, reading.source, _iso(now)):
            fired += 1
    if waiting:
        candles = _candles(ref, waiting, now)
        for row in waiting:
            wick = _find_wick(row, candles, price) if candles else None
            if wick and _trigger(row["id"], "wick", wick[1], "binance", _iso(wick[0].open_time)):
                fired += 1
            elif not wick:
                _touch(row["id"], now, 0)
    return fired


def run_cycle(now: Optional[datetime] = None) -> dict:
    """Un ciclo completo. Devuelve contadores (para el log y los tests)."""
    now = now or datetime.now(timezone.utc)
    stats = {"coins": 0, "triggered": 0, "sent": 0}
    with db.connect() as conn:
        active = conn.execute("SELECT * FROM price_alerts WHERE status='ACTIVE'").fetchall()
    if active:
        groups: dict[str, tuple[CoinRef, list]] = {}
        for row in active:
            ref = CoinRef(row["symbol"], row["binance_pair"], row["cmc_id"], row["cg_id"])
            groups.setdefault(ref.key, (ref, []))[1].append(row)
        try:
            readings = crypto.fetch_primary([ref for ref, _ in groups.values()])
        except Exception:
            logger.exception("no se pudieron leer los precios; se reintenta en el próximo ciclo")
            readings = {}
        confirm = _confirmer()
        for key, (ref, rows) in groups.items():
            reading = readings.get(key)
            if reading is None or not _valid_price(reading.price):
                logger.info("sin lectura válida de %s: se salta esta ronda", ref.symbol)
                continue
            try:
                if not _accept(ref, reading, now, confirm):
                    continue
                stats["coins"] += 1
                stats["triggered"] += _evaluate_coin(ref, rows, reading, now, confirm)
            except Exception:  # una moneda con problemas no debe frenar a las demás
                logger.exception("fallo revisando %s", ref.symbol)
    stats["sent"] = _flush_notifications()
    return stats


# ---------------------------------------------------------------- hilo de fondo

def _loop() -> None:
    interval = max(30, settings.price_check_interval_seconds)
    ttl = interval * 2 + 60
    while not _stop.is_set():
        try:
            if db.try_lease(LEASE_NAME, _holder, ttl):
                logger.info("revisión de alertas: %s", run_cycle())
        except Exception:
            logger.exception("fallo en la revisión de alertas")
        _stop.wait(interval)


def start() -> bool:
    """Arranca el hilo si hay token e intervalo > 0. No hace nada (False) si ya corre o está desactivado."""
    global _thread
    if settings.price_check_interval_seconds <= 0:
        return False
    if _thread is not None and _thread.is_alive():
        return False
    if not settings.telegram_bot_token:
        logger.warning("revisión de alertas desactivada: falta TELEGRAM_BOT_TOKEN")
        return False
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="price-checker", daemon=True)
    _thread.start()
    logger.info("revisión de alertas de precio iniciada (cada %s s)", max(30, settings.price_check_interval_seconds))
    return True


def stop() -> None:
    _stop.set()


def running() -> bool:
    return _thread is not None and _thread.is_alive()
