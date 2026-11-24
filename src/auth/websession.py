"""Acceso web fuera de Telegram: login con Telegram (OpenID Connect, código + PKCE en el servidor) y sesión por cookie.

Doc: core.telegram.org/bots/telegram-login. Modelo: ``taso-inv/app/telegram_login.py`` (mismo flujo, sin cuentas propias:
aquí la identidad ES el id de Telegram, igual que con el initData de la miniapp, así que alertas y estadísticas coinciden).

- El Client Secret solo vive en el .env del servidor; nunca llega al navegador.
- El ``id`` sale del claim ``id`` del id_token (NO de ``sub``). Solo se acepta un token con firma RS256 válida (JWKS de
  Telegram), ``iss``, ``aud`` (= Client ID), ``exp`` e ``iat``. No se manda ``nonce``: ``state`` + PKCE + la cookie de
  flujo ya atan el código a este navegador.
- Flujos (state + verificador PKCE) y sesiones viven en SQLite (``src/db.py``): el state se gasta una sola vez y la
  sesión se puede revocar. Del token de sesión solo se guarda su SHA-256.
- No se guardan tokens de Telegram: solo id, nombre, @usuario y foto.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import threading
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Callable, Optional

import httpx
import jwt

from config import settings
from src import db

ISSUER = "https://oauth.telegram.org"
AUTH_URL = ISSUER + "/auth"
TOKEN_URL = ISSUER + "/token"
JWKS_URL = ISSUER + "/.well-known/jwks.json"
SCOPE = "openid profile"

FLOW_TTL = 600  # el state y el verificador valen 10 minutos y una sola vez
MAX_FLOWS = 200  # /inicio es público: no debe poder llenar la base
SESSION_IDLE = 7 * 24 * 3600  # sin usar durante 7 días caduca...
SESSION_MAX = 30 * 24 * 3600  # ...y en cualquier caso a los 30 días
SESSION_TOUCH = 300  # last_seen se refresca como mucho cada 5 min
MAX_SESSIONS_PER_USER = 10
HTTP_S = 10

SCHEMA = """
CREATE TABLE IF NOT EXISTS web_flows (
    state_hash TEXT PRIMARY KEY,
    verifier   TEXT NOT NULL,
    created    REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS web_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    username   TEXT NOT NULL,
    photo_url  TEXT NOT NULL,
    created    REAL NOT NULL,
    last_seen  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions (user_id);
"""


class LoginError(Exception):
    """Algo del flujo no cuadra (token falso, código malo, Telegram caído). El mensaje es para el log, no para quien navega."""


@dataclass(frozen=True)
class LoginConfig:
    client_id: str
    secret: str
    redirect_uri: str


def login_config() -> Optional[LoginConfig]:
    """None si el login web está apagado (faltan Client ID, Secret o un origen https)."""
    if not settings.telegram_login_ready:
        return None
    path = "/" + settings.telegram_login_callback_path.strip().lstrip("/")
    redirect = settings.tasalo_public_url.strip().rstrip("/") + path
    return LoginConfig(settings.telegram_login_client_id.strip(), settings.telegram_login_client_secret.strip(), redirect)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


_ready: set[str] = set()
_ready_lock = threading.Lock()


class _Conn:
    """``db.connect()`` + las tablas de este módulo (se crean una vez por archivo; no toca el esquema de alertas)."""

    def __enter__(self):
        self._cm = db.connect()
        conn = self._cm.__enter__()
        path = db.db_file()
        if path not in _ready:
            with _ready_lock:
                if path not in _ready:
                    conn.executescript(SCHEMA)
                    _ready.add(path)
        return conn

    def __exit__(self, *exc):
        return self._cm.__exit__(*exc)


# ---------------------------------------------------------------- flujo (state + PKCE)
def start_flow(cfg: LoginConfig, now: Optional[float] = None) -> tuple[str, str]:
    """Devuelve (state, URL de Telegram). El state también va en una cookie corta para atarlo a este navegador."""
    moment = time.time() if now is None else now
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    with _Conn() as conn:
        conn.execute("DELETE FROM web_flows WHERE created <= ?", (moment - FLOW_TTL,))
        if conn.execute("SELECT COUNT(*) FROM web_flows").fetchone()[0] >= MAX_FLOWS:
            raise LoginError("demasiados intentos abiertos")
        conn.execute("INSERT INTO web_flows (state_hash, verifier, created) VALUES (?,?,?)", (_sha(state), verifier, moment))
    query = urllib.parse.urlencode(
        {
            "client_id": cfg.client_id,
            "redirect_uri": cfg.redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return state, f"{AUTH_URL}?{query}"


def consume_flow(state: Optional[str], now: Optional[float] = None) -> Optional[str]:
    """Gasta el state (una sola vez, valga o no) y devuelve el verificador PKCE. None si no existe, ya se usó o venció."""
    if not state or len(state) > 128:
        return None
    moment = time.time() if now is None else now
    digest = _sha(state)
    with _Conn() as conn:
        row = conn.execute("SELECT verifier, created FROM web_flows WHERE state_hash = ?", (digest,)).fetchone()
        if row is None or not conn.execute("DELETE FROM web_flows WHERE state_hash = ?", (digest,)).rowcount:
            return None
    return None if row["created"] + FLOW_TTL < moment else row["verifier"]


# ---------------------------------------------------------------- Telegram (red)
def exchange_code(cfg: LoginConfig, code: str, verifier: str, post: Callable[..., Any] = httpx.post) -> str:
    """Cambia el código por el id_token hablando directo con Telegram (Basic con Client ID y Secret). Nunca registra código ni secret."""
    try:
        res = post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": cfg.redirect_uri,
                "client_id": cfg.client_id,
                "code_verifier": verifier,
            },
            auth=(cfg.client_id, cfg.secret),
            headers={"Accept": "application/json"},
            timeout=HTTP_S,
            follow_redirects=False,
        )
        if res.status_code != 200 or len(res.content) > 65536:
            raise LoginError(f"canje fallido: HTTP {res.status_code}")
        data = res.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise LoginError(f"canje fallido: {type(exc).__name__}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("id_token"), str):
        raise LoginError("Telegram no devolvió id_token")
    return data["id_token"]


_jwks: Optional[jwt.PyJWKClient] = None


def _telegram_key(id_token: str):
    global _jwks
    if _jwks is None:
        _jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600, timeout=HTTP_S)
    return _jwks.get_signing_key_from_jwt(id_token).key


def _clean_photo(value: Any) -> str:
    url = str(value or "")
    return url if url.startswith("https://") and len(url) <= 512 and " " not in url else ""


def _clean_text(value: Any, limit: int) -> str:
    return " ".join("".join(c for c in str(value or "") if c.isprintable()).split())[:limit]


def verify_id_token(id_token: str, cfg: LoginConfig, get_key: Optional[Callable[[str], Any]] = None) -> dict[str, Any]:
    """Firma RS256 (solo ese algoritmo), iss, aud, exp e iat. Devuelve {id, name, username, photo_url}; lo demás es LoginError."""
    try:
        claims = jwt.decode(
            id_token,
            (get_key or _telegram_key)(id_token),
            algorithms=["RS256"],
            audience=cfg.client_id,
            issuer=ISSUER,
            leeway=30,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except (jwt.PyJWTError, OSError) as exc:
        raise LoginError(f"id_token inválido: {type(exc).__name__}") from exc
    tid = claims.get("id")
    if isinstance(tid, str) and tid.isdigit():
        tid = int(tid)
    if not isinstance(tid, int) or isinstance(tid, bool) or tid <= 0:
        raise LoginError("el id_token no trae un id de Telegram válido")
    username = str(claims.get("preferred_username") or "").lstrip("@")
    return {
        "id": tid,
        "name": _clean_text(claims.get("name"), 80),
        "username": username[:64] if username.replace("_", "").isalnum() else "",
        "photo_url": _clean_photo(claims.get("picture")),
    }


# ---------------------------------------------------------------- sesión
def create_session(profile: dict[str, Any], now: Optional[float] = None) -> str:
    """Crea la sesión del usuario ya verificado y devuelve el token para la cookie (en la base solo queda su hash)."""
    moment = time.time() if now is None else now
    token = secrets.token_urlsafe(32)
    with _Conn() as conn:
        conn.execute("DELETE FROM web_sessions WHERE last_seen <= ? OR created <= ?", (moment - SESSION_IDLE, moment - SESSION_MAX))
        conn.execute(
            "INSERT INTO web_sessions (token_hash, user_id, name, username, photo_url, created, last_seen) VALUES (?,?,?,?,?,?,?)",
            (_sha(token), profile["id"], profile["name"], profile["username"], profile["photo_url"], moment, moment),
        )
        conn.execute(
            "DELETE FROM web_sessions WHERE user_id = ? AND token_hash NOT IN "
            "(SELECT token_hash FROM web_sessions WHERE user_id = ? ORDER BY last_seen DESC, created DESC LIMIT ?)",
            (profile["id"], profile["id"], MAX_SESSIONS_PER_USER),
        )
    return token


def load_session(token: Optional[str], now: Optional[float] = None) -> Optional[dict[str, Any]]:
    """La sesión vigente de ese token ({id, name, username, photo_url}) o None (no existe, caducó o la cerraron)."""
    if not token or len(token) > 128:
        return None
    moment = time.time() if now is None else now
    digest = _sha(token)
    with _Conn() as conn:
        row = conn.execute("SELECT * FROM web_sessions WHERE token_hash = ?", (digest,)).fetchone()
        if row is None:
            return None
        if moment - row["last_seen"] > SESSION_IDLE or moment - row["created"] > SESSION_MAX:
            conn.execute("DELETE FROM web_sessions WHERE token_hash = ?", (digest,))
            return None
        if moment - row["last_seen"] > SESSION_TOUCH:
            conn.execute("UPDATE web_sessions SET last_seen = ? WHERE token_hash = ?", (moment, digest))
    return {"id": row["user_id"], "name": row["name"], "username": row["username"], "photo_url": row["photo_url"]}


def delete_session(token: Optional[str]) -> None:
    if not token or len(token) > 128:
        return
    with _Conn() as conn:
        conn.execute("DELETE FROM web_sessions WHERE token_hash = ?", (_sha(token),))
