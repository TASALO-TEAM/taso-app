from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración de la aplicación TASALO Miniapp."""
    
    # Flask
    flask_secret_key: str
    flask_env: str = "production"
    port: int = 5000
    
    # Backend API
    tasalo_api_url: str
    
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


settings = Settings()
