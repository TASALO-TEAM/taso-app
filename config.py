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

    # Prefijo bajo el que se publica la app (p. ej. "/miniapp"); vacío si cuelga de la raíz.
    # La app acepta las rutas con y sin ese prefijo, así funciona con Caddy haciendo
    # o no "strip" del prefijo.
    tasalo_base_path: str = ""

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


settings = Settings()
