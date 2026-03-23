# TASALO Miniapp

> Mini App web para Telegram que muestra tasas de cambio del dólar en Cuba en tiempo real.

[![Version](https://img.shields.io/badge/version-0.5.0--fase5-blue)](https://github.com/TASALO-TEAM/taso-app/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 📋 Descripción

**taso-app** es una Telegram Web App que consume la API de [taso-api](https://github.com/TASALO-TEAM/taso-api) para mostrar:

- Tasas actuales de ElToque, CADECA, BCC y Binance
- Histórico de evolución con gráficas (7, 14, 30 días)
- Tasas por provincia cubana
- Configuración de tema y auto-refresh

**Stack:** Python 3.12 · Flask · Jinja2 · Tailwind CSS (CDN) · Chart.js · Gunicorn

---

## 🚀 Requisitos del Sistema

**Mínimos:**
- Python 3.12+
- 512 MB RAM
- 100 MB storage

**Recomendados:**
- Python 3.12+
- 1 GB RAM
- 500 MB storage
- Systemd (para producción en VPS)

---

## 📦 Instalación

### Opción 1: uv (Recomendado)

```bash
# Clonar repositorio
git clone https://github.com/TASALO-TEAM/taso-app.git
cd taso-app

# Crear entorno virtual con uv
uv venv
source .venv/bin/activate

# Instalar dependencias
uv pip install -r requirements.txt
```

### Opción 2: pip tradicional

```bash
# Clonar repositorio
git clone https://github.com/TASALO-TEAM/taso-app.git
cd taso-app

# Crear entorno virtual
python -m venv .venv
source .venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt
```

---

## ⚙️ Configuración

### Variables de Entorno

```bash
# Copiar ejemplo
cp .env.example .env

# Editar con tus valores
nano .env
```

**Variables requeridas:**

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `FLASK_SECRET_KEY` | Clave secreta de Flask | `tu_clave_secreta_aqui` |
| `TASALO_API_URL` | URL del backend taso-api | `https://api.tasalo.app` |

**Variables opcionales:**

| Variable | Descripción | Default |
|----------|-------------|---------|
| `FLASK_ENV` | Entorno (development/production) | `production` |
| `PORT` | Puerto del servidor | `5000` |
| `LOG_LEVEL` | Nivel de logging | `INFO` |

### Generar FLASK_SECRET_KEY

```python
import secrets
print(secrets.token_hex(32))
```

---

## 🏃 Desarrollo

### Iniciar servidor

```bash
source .venv/bin/activate
uv run uvicorn src.app:app --reload --host 0.0.0.0 --port 5000
```

Acceder a: `http://localhost:5000`

### Ejecutar tests

```bash
TASALO_API_URL=http://test:8000 FLASK_SECRET_KEY=test pytest -v
```

---

## 🚀 Producción

### Opción 1: Gunicorn (Recomendado)

```bash
source .venv/bin/activate
uv run gunicorn src.app:app --bind 0.0.0.0:5000 --workers 4 --worker-class uvicorn.workers.UvicornWorker
```

### Opción 2: Systemd (VPS)

**Crear servicio:**

```bash
sudo nano /etc/systemd/system/taso-app.service
```

**Contenido:**

```ini
[Unit]
Description=TASALO Miniapp
After=network.target

[Service]
Type=notify
User=www-data
Group=www-data
WorkingDirectory=/var/www/taso-app
Environment="PATH=/var/www/taso-app/.venv/bin"
ExecStart=/var/www/taso-app/.venv/bin/uvicorn src.app:app --host 0.0.0.0 --port 5000
Restart=always

[Install]
WantedBy=multi-user.target
```

**Habilitar e iniciar:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable taso-app
sudo systemctl start taso-app
sudo systemctl status taso-app
```

### Opción 3: Docker

**Dockerfile:**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Instalar uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copiar requirements
COPY requirements.txt .
RUN uv pip install --system -r requirements.txt

# Copiar aplicación
COPY . .

EXPOSE 5000

CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "5000"]
```

**Build y run:**

```bash
docker build -t taso-app .
docker run -p 5000:5000 --env-file .env taso-app
```

### Opción 4: Railway / Render

**railway.json:**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "uvicorn src.app:app --host 0.0.0.0 --port $PORT",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

**Variables de entorno en Railway:**
- `FLASK_SECRET_KEY`: tu_clave_secreta
- `TASALO_API_URL`: https://api.tasalo.app
- `PORT`: 5000 (automático en Railway)

---

## 🔗 Integración con Telegram Bot

### Registrar Miniapp en BotFather

1. Abrir [@BotFather](https://t.me/botfather)
2. `/mybots` → Seleccionar tu bot
3. `Bot Settings` → `Menu Button` → `Configure Menu Button`
4. Enviar URL: `https://tu-dominio.com`
5. Enviar título: `📊 Ver Tasas`

### Agregar inline button en taso-bot

En el código de taso-bot, agregar inline keyboard:

```python
from telegram import InlineKeyboardButton, InlineKeyboardMarkup

keyboard = [
    [InlineKeyboardButton("🌐 Abrir TASALO Web", web_app={"url": "https://tu-dominio.com"})]
]
reply_markup = InlineKeyboardMarkup(keyboard)
```

---

## 📁 Estructura del Proyecto

```
taso-app/
├── .env.example          # Variables de entorno de ejemplo
├── .gitignore
├── README.md
├── requirements.txt      # Dependencias Python
├── docs/
│   └── plans/           # Planes de implementación
├── src/
│   ├── app.py           # Flask app factory
│   └── config.py        # pydantic-settings
├── static/
│   ├── css/
│   │   └── tasalo.css   # Design system
│   └── js/
│       └── app.js       # Client-side logic
├── templates/
│   ├── base.html        # Layout base
│   ├── index.html       # Vista principal
│   ├── history.html     # Vista historial
│   ├── provincias.html  # Vista provincias
│   ├── settings.html    # Vista configuración
│   └── error.html       # Vista error 404/500
└── tests/
    ├── test_app.py      # Tests de rutas
    ├── test_config.py   # Tests de configuración
    ├── test_settings.py # Tests de settings
    └── test_errors.py   # Tests de error handlers
```

---

## 🧪 Testing

### Ejecutar todos los tests

```bash
TASALO_API_URL=http://test:8000 FLASK_SECRET_KEY=test pytest -v
```

### Ejecutar tests específicos

```bash
# Tests de rutas
pytest tests/test_app.py -v

# Tests de configuración
pytest tests/test_config.py -v

# Tests de settings
pytest tests/test_settings.py -v

# Tests de errores
pytest tests/test_errors.py -v
```

### Cobertura de tests

```bash
pip install pytest-cov
TASALO_API_URL=http://test:8000 FLASK_SECRET_KEY=test pytest --cov=src --cov-report=html
```

---

## 🐛 Solución de Problemas

### Error: "ModuleNotFoundError: No module named 'src'"

```bash
# Asegurar que estás en el directorio correcto
cd /var/www/taso-app

# Verificar estructura
ls -la src/
```

### Error: "Address already in use"

```bash
# Matar proceso en puerto 5000
lsof -ti:5000 | xargs kill -9

# O cambiar puerto en .env
PORT=5001
```

### Error: "Invalid API URL"

Verificar que `TASALO_API_URL` en `.env` sea accesible:

```bash
curl -X GET https://api.tasalo.app/api/v1/health
```

### Logs en producción

```bash
# Systemd
sudo journalctl -u taso-app -f

# Docker
docker logs -f <container_id>

# Gunicorn directo
# Los logs van a stdout/stderr
```

---

## 📊 Métricas

| Métrica | Valor |
|---------|-------|
| Tests passing | 26+ |
| Cobertura | ~80% |
| Vistas | 5 (index, history, provincias, settings, error) |
| Endpoints Flask | 5 (/, /history, /provincias, /settings, /health) |

---

## 🔗 Enlaces Relacionados

- **taso-api:** https://github.com/TASALO-TEAM/taso-api
- **taso-bot:** https://github.com/TASALO-TEAM/taso-bot
- **Documentación oficial:** https://github.com/TASALO-TEAM/tasalo

---

## 📝 License

MIT License - ver [LICENSE](LICENSE) para detalles.
