import logging

from pydantic_settings import BaseSettings, SettingsConfigDict

_logger = logging.getLogger("taso-miniapp")


class Settings(BaseSettings):
    """Configuración de la aplicación TASALO Miniapp."""

    # Flask
    flask_secret_key: str
    flask_env: str = "production"
    port: int = 5040

    # Backend API
    tasalo_api_url: str

    # Clave admin de taso-api (misma que ADMIN_API_KEY de taso-api/taso-bot).
    # Nombre nuevo: TASALO_ADMIN_KEY. Se acepta ADMIN_API_KEY (obsoleto) durante una versión.
    tasalo_admin_key: str = ""
    admin_api_key: str = ""

    # Telegram: el BFF valida el initData con el token del bot (solo en .env del servidor)
    telegram_bot_token: str = ""
    # Usuario del bot (sin @), para el enlace de la pantalla «Abre desde Telegram»
    bot_username: str = "tasalobot"
    # IDs de Telegram con acceso a /admin (separados por comas)
    admin_chat_ids: str = ""
    # Edad máxima del initData en segundos (24 h)
    initdata_max_age: int = 86400
    # Peticiones por minuto y usuario al BFF (0 = sin límite)
    api_rate_limit_per_minute: int = 120
    # Analisis de IA (Panorama) por usuario y hora (0 = sin limite). Solo cuentan los que de verdad llaman a Groq.
    ai_rate_limit_per_hour: int = 5
    alert_create_rate_limit_per_minute: int = 10  # crear alertas de precio propias (cada una consulta las APIs de precios)
    # Visitantes sin sesion (fuera de Telegram, clave = IP): solo lectura publica. 0 = sin limite.
    anon_rate_limit_per_minute: int = 60
    login_rate_limit_per_minute: int = 10  # intentos de iniciar sesion por IP

    # --- Acceso web fuera de Telegram: login con Telegram (OIDC + PKCE, ver src/auth/websession.py) ---
    # Client ID y Secret de @BotFather > Web Login (los mismos del bot: TELEGRAM_LOGIN_CLIENT_ID/SECRET). Solo en el .env del servidor.
    telegram_login_client_id: str = ""
    telegram_login_client_secret: str = ""
    # Origen publico (https) con el que se arma el redirect_uri; nunca sale del Host de la peticion.
    tasalo_public_url: str = "https://tasalo.duckdns.org"
    # Ruta del callback registrada en BotFather. Con el Caddy actual sirve tambien "/miniapp/auth/telegram/callback".
    telegram_login_callback_path: str = "/auth/telegram/callback"

    # Prefijo bajo el que se publica la app (p. ej. "/miniapp"); vacío si cuelga de la raíz.
    # La app acepta las rutas con y sin ese prefijo, así funciona con Caddy haciendo
    # o no "strip" del prefijo.
    tasalo_base_path: str = ""

    # --- Mercado /p y alertas de precio cripto (S10) ---
    # Claves copiadas del .env de taso-bot; cada una admite varias separadas por coma (rotacion round-robin).
    groq_api_key: str = ""
    coinmarketcap_api_key: str = ""
    # Pool de CMC dedicado a las alertas; si esta vacio se usa el interactivo.
    cmc_api_key_alerta: str = ""
    coingecko_api_key: str = ""
    # API publica de mercado de Binance: primero la de EE. UU. (api.binance.us) y, si falla o no tiene el par,
    # la global (api.binance.com) como respaldo, igual que el bot. api.binance.com puede dar 451 desde el VPS.
    binance_base_url: str = "https://api.binance.us"
    binance_fallback_url: str = "https://api.binance.com"
    # Base de datos SQLite propia de la app (alertas de precio, uso de monedas). Relativa a la raiz del proyecto.
    db_path: str = "data/taso-app.db"
    # Revision de alertas cada N segundos (300 = 5 min). 0 desactiva el hilo (tests, tareas puntuales).
    price_check_interval_seconds: int = 300

    # Logging
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    @property
    def debug(self) -> bool:
        return self.flask_env.lower() == "development"

    @property
    def admin_key(self) -> str:
        """Clave admin efectiva: TASALO_ADMIN_KEY, o ADMIN_API_KEY (obsoleta) como respaldo."""
        if self.tasalo_admin_key:
            return self.tasalo_admin_key
        if self.admin_api_key:
            _logger.warning(
                "ADMIN_API_KEY está obsoleta; renómbrala a TASALO_ADMIN_KEY en el .env"
            )
        return self.admin_api_key

    @property
    def base_path(self) -> str:
        """Prefijo normalizado: '' o '/miniapp' (con barra inicial, sin barra final)."""
        value = (self.tasalo_base_path or "").strip().strip("/")
        return f"/{value}" if value else ""

    @property
    def admin_ids(self) -> frozenset[int]:
        ids: set[int] = set()
        for part in (self.admin_chat_ids or "").split(","):
            part = part.strip()
            if part.lstrip("-").isdigit():
                ids.add(int(part))
        return frozenset(ids)


    @property
    def telegram_login_ready(self) -> bool:
        """El login web solo se enciende con Client ID numerico, Secret y un origen https (si no, la web no muestra el boton)."""
        return (
            self.telegram_login_client_id.strip().isdigit()
            and bool(self.telegram_login_client_secret.strip())
            and self.tasalo_public_url.strip().startswith("https://")
        )

    @staticmethod
    def _split_keys(value: str) -> list[str]:
        return [k.strip() for k in (value or "").split(",") if k.strip()]

    @property
    def groq_keys(self) -> list[str]:
        return self._split_keys(self.groq_api_key)

    @property
    def cmc_keys(self) -> list[str]:
        """Pool interactivo de CMC (pantalla Mercado)."""
        return self._split_keys(self.coinmarketcap_api_key)

    @property
    def cmc_alert_keys(self) -> list[str]:
        """Pool de CMC para el chequeo de alertas; si no hay uno propio, el interactivo."""
        return self._split_keys(self.cmc_api_key_alerta) or self.cmc_keys

    @property
    def coingecko_keys(self) -> list[str]:
        return self._split_keys(self.coingecko_api_key)


settings = Settings()
