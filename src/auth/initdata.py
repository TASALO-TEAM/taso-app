"""Validación del ``initData`` de Telegram Mini Apps (método HMAC con el token del bot).

Módulo puro: sin Flask ni red. Ver ``docs/TELEGRAM_MINIAPP.md``.

Algoritmo (doc oficial de Telegram):
  1. Parsear el query string; quitar ``hash``.
  2. ``data_check_string`` = el resto de pares ``clave=valor`` ordenados por
     clave y unidos con ``\\n``. ``signature`` SÍ forma parte de este string
     (solo ``hash`` se excluye en el método con token del bot).
  3. ``secret = HMAC_SHA256(key="WebAppData", msg=bot_token)``.
  4. ``hash_esperado = HMAC_SHA256(key=secret, msg=data_check_string)`` en hex.
  5. Comparar en tiempo constante y comprobar que ``auth_date`` no es viejo.

La identidad del usuario sale SOLO de aquí; nunca de ``initDataUnsafe``,
de la URL ni del cuerpo de la petición.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from urllib.parse import parse_qsl

# Tolerancia para relojes desajustados (auth_date ligeramente en el futuro).
CLOCK_SKEW_SECONDS = 60
# Tope defensivo: un initData real pesa unos cientos de bytes.
MAX_INIT_DATA_LENGTH = 8192


class InitDataError(Exception):
    """initData inválido. ``code`` es estable y seguro de mostrar; no filtra detalles."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class InitData:
    user_id: int
    auth_date: int
    user: dict[str, Any]
    start_param: Optional[str] = None
    query_id: Optional[str] = None
    raw: dict[str, str] = field(default_factory=dict, repr=False)

    @property
    def first_name(self) -> str:
        return str(self.user.get("first_name") or "")

    @property
    def language_code(self) -> Optional[str]:
        return self.user.get("language_code")

    @property
    def last_name(self) -> str:
        return str(self.user.get("last_name") or "")[:64]

    @property
    def username(self) -> str:
        """@usuario sin la arroba (vacío si no tiene)."""
        name = str(self.user.get("username") or "").lstrip("@")
        return name[:64] if re.fullmatch(r"[A-Za-z0-9_]{1,64}", name) else ""

    @property
    def photo_url(self) -> str:
        """Foto de perfil solo si es una URL https corta; si no, vacío (la app pinta la inicial)."""
        url = str(self.user.get("photo_url") or "")
        return url if url.startswith("https://") and len(url) <= 512 and " " not in url else ""

    @property
    def is_premium(self) -> bool:
        return bool(self.user.get("is_premium", False))

    @property
    def allows_write_to_pm(self) -> bool:
        return bool(self.user.get("allows_write_to_pm", False))


def compute_hash(fields: dict[str, str], bot_token: str) -> str:
    """Hash esperado para ``fields`` (sin ``hash``)."""
    data_check_string = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(secret, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()


def validate_init_data(
    init_data: str,
    bot_token: str,
    max_age_seconds: int = 86400,
    now: Optional[float] = None,
) -> InitData:
    """Valida ``init_data`` y devuelve la identidad. Lanza ``InitDataError`` si algo falla."""
    if not bot_token:
        # Servidor mal configurado: nunca aceptar nada.
        raise InitDataError("server_misconfigured")
    if not init_data or not isinstance(init_data, str):
        raise InitDataError("missing")
    if len(init_data) > MAX_INIT_DATA_LENGTH:
        raise InitDataError("too_large")

    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError:
        raise InitDataError("malformed")

    fields: dict[str, str] = {}
    for key, value in pairs:
        if key in fields:
            raise InitDataError("duplicate_field")
        fields[key] = value

    received_hash = fields.pop("hash", None)
    if not received_hash:
        raise InitDataError("missing_hash")

    expected = compute_hash(fields, bot_token)
    if not hmac.compare_digest(received_hash.lower().encode("utf-8"), expected.encode("utf-8")):
        raise InitDataError("bad_hash")

    auth_date_raw = fields.get("auth_date")
    try:
        auth_date = int(auth_date_raw) if auth_date_raw is not None else None
    except ValueError:
        auth_date = None
    if auth_date is None or auth_date <= 0:
        raise InitDataError("bad_auth_date")

    current = time.time() if now is None else now
    if auth_date > current + CLOCK_SKEW_SECONDS:
        raise InitDataError("auth_date_in_future")
    if current - auth_date > max_age_seconds:
        raise InitDataError("expired")

    user_raw = fields.get("user")
    if not user_raw:
        raise InitDataError("missing_user")
    try:
        user = json.loads(user_raw)
    except (ValueError, TypeError):
        raise InitDataError("bad_user")
    if not isinstance(user, dict):
        raise InitDataError("bad_user")
    user_id = user.get("id")
    # bool es subclase de int: se rechaza explícitamente.
    if isinstance(user_id, bool) or not isinstance(user_id, int) or user_id <= 0:
        raise InitDataError("bad_user")

    return InitData(
        user_id=user_id,
        auth_date=auth_date,
        user=user,
        start_param=fields.get("start_param"),
        query_id=fields.get("query_id"),
        raw=dict(fields),
    )
