# TASALO App

Telegram Mini App para consultar tasas de cambio del dólar en Cuba en tiempo real.

## Stack

- **Python 3.12** · **Flask 3** · **Jinja2**
- **Tailwind CSS** (CDN) · **Chart.js**
- **pydantic-settings** · **uvicorn** · **gunicorn**

## Requisitos

- Python 3.12+
- uv (package manager)
- taso-api corriendo (para datos reales)

## Instalación

```bash
# Clonar repositorio
cd taso-miniapp

# Crear entorno virtual con uv
uv venv
source .venv/bin/activate

# Instalar dependencias
uv pip install -r requirements.txt

# Copiar variables de entorno
cp .env.example .env

# Editar .env con tu configuración
nano .env
```

## Configuración

```bash
# .env
FLASK_SECRET_KEY=tu_clave_secreta_aqui
FLASK_ENV=production
PORT=5000
TASALO_API_URL=http://localhost:8000
LOG_LEVEL=INFO
```

## Desarrollo

```bash
# Correr servidor de desarrollo
uv run uvicorn src.app:app --reload --host 0.0.0.0 --port 5000

# Abrir en navegador
http://localhost:5000
```

## Producción

```bash
# Con Gunicorn (workers sync para Flask WSGI)
uv run gunicorn src.app:app \
  --bind 0.0.0.0:5000 \
  --workers 4
```

## Testing

```bash
# Ejecutar tests
FLASK_SECRET_KEY=test TASALO_API_URL=http://test:8000 pytest

# Con coverage
FLASK_SECRET_KEY=test TASALO_API_URL=http://test:8000 pytest --cov=src
```

## Estructura del Proyecto

```
taso-miniapp/
├── src/
│   └── app.py              # Flask app
├── templates/
│   ├── base.html           # Layout base
│   ├── index.html          # Vista principal
│   └── history.html        # Vista historial
├── static/
│   └── css/
│       └── tasalo.css      # Design system
├── tests/
│   ├── test_config.py
│   └── test_app.py
├── config.py               # pydantic-settings
├── requirements.txt
└── README.md
```

## Rutas

| Ruta | Descripción |
|------|-------------|
| `GET /` | Vista principal con tasas actuales |
| `GET /history` | Vista historial con gráfica |
| `GET /health` | Health check `{"ok": true}` |

## Integración con Telegram

1. Desplegar con HTTPS (Railway, Render, VPS)
2. Registrar URL en BotFather
3. Agregar botón inline en taso-bot

## Design System

La miniapp usa el design system TASALO con:
- Glassmorphism (backdrop-filter blur)
- Colores: `#5b8aff` (accent), `#09091e` (bg dark)
- Fuentes: JetBrains Mono (números), Space Grotesk (UI)
- Soporte dark/light mode automático

## License

MIT
