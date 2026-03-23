# TASALO — Prompt de Continuidad para Agente

> **Generado:** 2026-03-21
> **Última actualización:** 2026-03-22 (taso-app Fase 2 completada ✅)
> **Estado del Ecosistema:** taso-api 100% ✅ | taso-bot 100% ✅ | taso-app 33% 🚧 | taso-extension 0% ⏳

---

## 🎯 Contexto del Proyecto

**TASALO** es una plataforma distribuida para consultar tasas de cambio del dólar en Cuba en tiempo real. El ecosistema tiene 4 componentes:

1. **taso-api** — Backend FastAPI, única pieza que habla con fuentes externas ✅ **COMPLETADO**
2. **taso-bot** — Bot de Telegram (python-telegram-bot) ✅ **COMPLETADO**
3. **taso-app** — Mini App web dentro de Telegram (Flask + Tailwind) 🚧 **EN DESARROLLO**
4. **taso-extension** — Extensión de navegador (Manifest V3) ⏳ **PENDIENTE**

**Arquitectura:**
```
ElToque API ──┐
CADECA ───────┤
BCC ──────────├──> taso-api (FastAPI + PostgreSQL) ──> Bot, taso-app, Extension
Binance ──────┘
```

---

## 📁 Estado Actual de los Repositorios

### taso-api ✅ COMPLETADO

**Directorio:** `/home/ersus/tasalo/taso-api`

**Estado:** Fase 6 ✅ COMPLETADA - PROYECTO 100% COMPLETADO

**Tags:** `v1.0.0-fase1` ✅, `v1.1.0-fase2` ✅, `v1.2.0-fase3` ✅, `v1.3.0-fase4` ✅, `v1.4.0-fase5` ✅, `v1.5.0-fase6` ✅

**Resumen:**
- ✅ 4 scrapers funcionando (ElToque, CADECA, BCC, Binance)
- ✅ Scheduler corriendo cada 5 minutos con trackeo de estado
- ✅ 7 endpoints API REST (5 públicos + 2 admin protegidos)
- ✅ 58 tests pasando
- ✅ Exception handlers globales
- ✅ Logging estructurado
- ✅ README completo con guía de producción

**Ver:** `PROGRESS.md` para detalles completos de taso-api.

---

### taso-bot ✅ COMPLETADO

**Directorio:** `/home/ersus/tasalo/taso-bot`

**Estado:** Fase 6 ✅ COMPLETADA - PROYECTO 100% COMPLETADO

**Tags:** `v0.1.0-fase1` ✅, `v0.2.0-fase2` ✅, `v0.3.0-fase3` ✅, `v0.4.0-fase4` ✅, `v0.5.0-fase5` ✅, `v0.6.0-fase6` ✅

**Documento de Diseño:** `2026-03-22-tasalo-bot-design.md`

**Stack:** Python 3.12 · python-telegram-bot v21 · httpx · Pillow · pydantic-settings · aiohttp

**Resumen:**
- ✅ 6 fases completadas (104 tests passing)
- ✅ Comando /tasalo con imagen + texto + botones inline
- ✅ Callbacks: refresh, historial, provincias
- ✅ Comandos admin: /refresh, /status
- ✅ Error handling global + logging estructurado
- ✅ README completo con guía de producción (systemd, Docker, tmux)

**Ver:** `PROGRESS.md` para detalles completos de taso-bot.

---

### taso-app 🚧 EN DESARROLLO

**Directorio:** `/home/ersus/tasalo/taso-app`

**Estado:** Fase 2 ✅ COMPLETADA - 2/6 fases (33%)

**Tags:** `v0.1.0-fase1` ✅, `v0.2.0-fase2` ✅

**Documento de Diseño:** `2026-03-22-taso-app-design.md`

**Stack:** Python 3.12 · Flask · Jinja2 · Tailwind CSS (CDN) · Gunicorn · pydantic-settings

**Fase 1 Completada:**
- ✅ Project scaffold creado con `uv`
- ✅ Configuración con pydantic-settings (4 tests)
- ✅ Flask app con 3 rutas (/, /history, /health)
- ✅ Templates base con Tailwind CDN + Telegram Web App SDK
- ✅ Design system CSS completo (glassmorphism, tokens, dark/light mode)
- ✅ 7 tests passing en total
- ✅ README completo con setup instructions
- ✅ Tag `v0.1.0-fase1` creado

**Fase 2 Completada:**
- ✅ `static/js/app.js`: JavaScript del cliente implementado
  - `fetchLatest()` → GET `/api/v1/tasas/latest`
  - `renderRates(data)` → puebla DOM con datos
  - `renderChange(change)` → indicador 🔺🔻―
  - Auto-refresh cada 60 segundos
- ✅ `templates/index.html`: Vista principal completada
  - Skeleton loader con animación shimmer
  - Error state con botón de reintentar
  - Timestamp de última actualización
- ✅ 10 tests Python + 3 test suites JS pasando
- ✅ Tag `v0.2.0-fase2` creado

**Próxima Acción:** Comenzar Fase 3 — Vista Historial con Chart.js.

---

### taso-extension ⏳ PENDIENTE

**Directorio:** `/home/ersus/tasalo/taso-extension`

**Estado:** No iniciado

**Documento de Diseño:** `2026-03-21-tasalo-extension-design.md`

**Stack:** JavaScript vanilla · Manifest V3 · CSS Variables

---

## 🎯 Próxima Acción Requerida

**taso-app — Fase 3:** Vista Historial con Chart.js

1. **Agregar Chart.js CDN en `base.html`:**
   - `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`

2. **Completar `templates/history.html`:**
   - Canvas para Chart.js
   - Selectores de moneda (USD/EUR/MLC) y días (7/14/30)
   - Botón de navegación ← volver

3. **Implementar en `static/js/app.js`:**
   - `fetchHistory(source, currency, days)` → GET `/api/v1/tasas/history`
   - `renderChart(labels, data)` → inicializa Chart.js
   - Colores: línea `--accent`, área `rgba(91,138,255,0.1)`

4. **Seguir TDD:** Tests primero, implementación mínima, verificar, commit

5. **Actualizar PROGRESS.md** después de cada tarea completada

---

## 📋 Documentos del Proyecto

Todos los documentos están en `/home/ersus/tasalo/plans/`:

### Diseño del Ecosistema
- `2026-03-21-tasalo-ecosystem-design.md` — Arquitectura general
- `2026-03-21-tasalo-api-design.md` — Diseño de taso-api
- `2026-03-22-tasalo-bot-design.md` — Diseño de taso-bot ✅
- `2026-03-22-taso-app-design.md` — Diseño de taso-app ✅
- `2026-03-21-tasalo-extension-design.md` — Diseño de taso-extension

### Planes de Implementación
- `2026-03-21-taso-api-fase1.md` ✅
- `2026-03-21-taso-api-fase2-scrapers.md` ✅
- `2026-03-21-taso-api-fase3-scheduler.md` ✅
- `2026-03-22-taso-api-fase4-endpoints.md` ✅
- `2026-03-22-taso-app-fase1.md` ✅

### Seguimiento
- `PROGRESS.md` — Progreso detallado por repositorio
- `CONTINUITY.md` — Este archivo

---

## 🚀 Comandos Útiles por Repositorio

### taso-api
```bash
cd /home/ersus/tasalo/taso-api
source .venv/bin/activate
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
pytest
```

### taso-bot
```bash
cd /home/ersus/tasalo/taso-bot
uv venv
source .venv/bin/activate
python src/main.py
pytest
```

### taso-app
```bash
cd /home/ersus/tasalo/taso-app
source .venv/bin/activate
uv run gunicorn src.app:app --bind 0.0.0.0:5000 --workers 1
FLASK_SECRET_KEY=test TASALO_API_URL=http://test:8000 pytest
```

---

## 📊 Estado de Fases por Repositorio

| Repo | Fase 1 | Fase 2 | Fase 3 | Fase 4 | Fase 5 | Fase 6 | Total |
|------|--------|--------|--------|--------|--------|--------|-------|
| **taso-api** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6/6 (100%) |
| **taso-bot** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 6/6 (100%) |
| **taso-app** | ✅ | ✅ | ⏳ | ⏳ | ⏳ | ⏳ | 2/6 (33%) |
| **taso-extension** | ⏳ | ⏳ | ⏳ | ⏳ | ⏳ | — | 0/5 (0%) |

**Progreso Total del Ecosistema:** 14/23 fases (61%) 🚧

---

## 🔗 Enlaces Relacionados

- **Repositorio GitHub:** https://github.com/TASALO-TEAM/taso-app
- **Rama de trabajo:** `dev`
- **Rama principal:** `main`

---

**Fin del documento de continuidad.**
