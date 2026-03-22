import os
import sys
import pytest

# Agregar raíz del proyecto al path para imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Settings


def test_settings_required_fields():
    """Settings requiere flask_secret_key y tasalo_api_url."""
    os.environ["FLASK_SECRET_KEY"] = "test_secret"
    os.environ["TASALO_API_URL"] = "http://test:8000"
    
    settings = Settings()
    
    assert settings.flask_secret_key == "test_secret"
    assert settings.tasalo_api_url == "http://test:8000"


def test_settings_default_values():
    """Settings tiene valores por defecto correctos."""
    os.environ["FLASK_SECRET_KEY"] = "test_secret"
    os.environ["TASALO_API_URL"] = "http://test:8000"
    os.environ.pop("FLASK_ENV", None)
    os.environ.pop("PORT", None)
    os.environ.pop("LOG_LEVEL", None)
    
    settings = Settings()
    
    assert settings.flask_env == "production"
    assert settings.port == 5000
    assert settings.log_level == "INFO"


def test_settings_debug_property():
    """Property debug retorna True cuando flask_env es development."""
    os.environ["FLASK_SECRET_KEY"] = "test_secret"
    os.environ["TASALO_API_URL"] = "http://test:8000"
    os.environ["FLASK_ENV"] = "development"
    
    settings = Settings()
    
    assert settings.debug is True


def test_settings_debug_property_production():
    """Property debug retorna False cuando flask_env es production."""
    os.environ["FLASK_SECRET_KEY"] = "test_secret"
    os.environ["TASALO_API_URL"] = "http://test:8000"
    os.environ["FLASK_ENV"] = "production"
    
    settings = Settings()
    
    assert settings.debug is False
