# TASALO — Progreso de Implementación del Ecosistema

> **Última actualización:** 2026-03-22 (taso-app Fase 1 completada ✅)
> **Estado General:** taso-api 100% ✅ | taso-bot 100% ✅ | taso-app 17% 🚧 | taso-extension 0% ⏳

---

## 📋 Visión General del Proyecto

**Objetivo:** Implementar **TASALO** — una plataforma distribuida para consultar tasas de cambio del dólar en Cuba en tiempo real. El ecosistema tiene 4 componentes:

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

## 📊 Estado por Repositorio

| Repositorio | Estado | Progreso | Última Actualización |
|-------------|--------|----------|---------------------|
| **taso-api** | ✅ Completado | 6/6 fases (100%) | 2026-03-22 |
| **taso-bot** | ✅ Completado | 6/6 fases (100%) | 2026-03-22 (Fase 6 ✅) |
| **taso-app** | 🚧 En Desarrollo | 1/6 fases (17%) | 2026-03-22 (Fase 1 ✅) |
| **taso-extension** | ⏳ Pendiente | 0/5 fases (0%) | — |

---

## 🚀 taso-api — Progreso Detallado

**Repositorio:** `tasalo/taso-api`
**Stack:** Python 3.12 · FastAPI · PostgreSQL/SQLite · SQLAlchemy async · Alembic · APScheduler

---

## ✅ Fase 1 — Scaffold y Base de Datos
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-21
**Completado:** 2026-03-21
**Tag:** `v1.0.0-fase1`

**Objetivo:** Repositorio funcional con conexión a base de datos y endpoint de health check.

**Resultados:**
- ✅ 11 tests pasando
- ✅ Servidor corre en `http://localhost:8000`
- ✅ `GET /api/v1/health` devuelve `{"ok": true, "db": "connected"}`
- ✅ Swagger UI disponible en `/docs`
- ✅ Alembic configurado con SQLite (dev) y PostgreSQL (prod)
- ✅ Tag `v1.0.0-fase1` creado

---

## ✅ Fase 2 — Scrapers
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-21
**Completado:** 2026-03-21
**Tag:** `v1.1.0-fase2`

**Objetivo:** Los 4 scrapers/clientes funcionando como funciones independientes testeables.

**Resultados:**
- ✅ `scrapers/eltoque.py` — Cliente API ElToque con httpx y Bearer token (5 tests)
- ✅ `scrapers/binance.py` — Cliente API Binance para pares BTCUSDT, ETHUSDT, USDTUSDT (4 tests)
- ✅ `scrapers/cadeca.py` — Scraper CADECA con httpx + HTMLParser (4 tests)
- ✅ `scrapers/bcc.py` — Scraper BCC con httpx + HTMLParser (4 tests)
- ✅ 17 tests pasando en total
- ✅ Test manual de integración disponible en `scripts/test_scrapers_manual.py`

**Código migrado desde legacy:**
- Lógica de `obtener_tasas_eltoque()` → `fetch_eltoque()` (async)
- Estructura de datos normalizada
- Manejo de errores robustecido

---

## ✅ Fase 3 — Servicio de Tasas y Scheduler
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v1.2.0-fase3`

**Objetivo:** El backend recoge datos automáticamente y los persiste en PostgreSQL.

**Resultados:**
- ✅ `services/rates_service.py` — Servicio de negocio implementado
- ✅ `fetch_all_sources()` — Ejecuta los 4 scrapers en paralelo con timeouts individuales (2 tests)
- ✅ `save_snapshot()` — Persiste datos con normalización por fuente (2 tests)
- ✅ `get_latest_rates()` — Consulta últimos snapshots por fuente (2 tests)
- ✅ `calculate_change()` — Determina up/down/neutral con tolerancia 0.0001 (4 tests)
- ✅ `services/scheduler.py` — APScheduler configurado con job `refresh_all` (2 tests)
- ✅ Job `refresh_all` corre cada 5 minutos automáticamente
- ✅ Scheduler integrado en FastAPI lifespan (startup/shutdown)
- ✅ 12 tests nuevos pasando
- ✅ Tag `v1.2.0-fase3` creado

**Legacy patterns reutilizados:**
- Timeout individual por scraper (evita que uno lento bloquee todo)
- Tolerancia 0.0001 para calcular cambios 🔺/🔻
- Normalización de datos por fuente (ElToque vs CADECA vs BCC vs Binance)

---

## ✅ Fase 4 — Endpoints Públicos
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v1.3.0-fase4`

**Objetivo:** API consumible por los servicios clientes.

**Resultados:**
- ✅ `schemas/rates.py` — 6 Pydantic schemas implementados (CurrencyRate, SourceRatesResponse, LatestRatesResponse, HistoryResponse, etc.)
- ✅ `routers/rates.py` — 5 endpoints públicos implementados:
  - `GET /api/v1/tasas/latest` — Tasas combinadas de todas las fuentes con indicadores de cambio
  - `GET /api/v1/tasas/eltoque` — Solo tasas de ElToque
  - `GET /api/v1/tasas/cadeca` — Solo tasas de CADECA
  - `GET /api/v1/tasas/bcc` — Solo tasas de BCC
  - `GET /api/v1/tasas/history` — Histórico con query params (source, currency, days)
- ✅ `services/rates_service.py` — Funciones `get_source_rates()` y `get_history()` agregadas
- ✅ `database.py` — Dependency provider `get_db()` agregado
- ✅ CORS middleware configurado en `main.py`
- ✅ 10 tests nuevos de integración para routers
- ✅ 50 tests pasando en total
- ✅ Tag `v1.3.0-fase4` creado

**Endpoints verificados:**
- Swagger UI disponible en `/docs`
- Respuestas JSON con estructura consistente `{ok, data, updated_at}`
- Indicadores de cambio (up/down/neutral) calculados con tolerancia 0.0001
- Query params validados (days: 1-365)

---

## ✅ Fase 5 — Endpoints Admin y Auth
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v1.4.0-fase5`

**Objetivo:** Endpoints protegidos para operaciones privilegiadas.

**Resultados:**
- ✅ `middleware/auth.py` — Dependencia FastAPI que valida header `X-API-Key` (2 tests)
  - Retorna 401 si la key es inválida o faltante
  - Usa `APIKeyHeader` de FastAPI
- ✅ `routers/admin.py` — 2 endpoints admin implementados:
  - `POST /api/v1/admin/refresh` — Dispara fetch inmediato de todas las fuentes (1 test)
  - `GET /api/v1/admin/status` — Devuelve estado del scheduler desde `SchedulerStatus` (2 tests)
- ✅ `schemas/admin.py` — 5 Pydantic schemas implementados:
  - `SchedulerStatusResponse`, `AdminStatusResponse`, `RefreshResult`, `RefreshData`, `RefreshResponse`
- ✅ `services/scheduler.py` — Actualizado para trackear estado en `scheduler_status`:
  - Actualiza `last_run_at`, `last_success_at`, `error_count`, `last_error`
  - Manejo de errores con rollback y actualización de estado
- ✅ 8 tests nuevos pasando
- ✅ 58 tests pasando en total
- ✅ Tag `v1.4.0-fase5` creado

**Endpoints protegidos:**
- Todos los endpoints `/api/v1/admin/*` requieren header `X-API-Key`
- API key se configura vía `ADMIN_API_KEY` en `.env`
- Swagger UI muestra los endpoints protegidos con símbolo de candado

---

## ✅ Fase 6 — Hardening y README
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v1.5.0-fase6`

**Objetivo:** El servicio está listo para producción básica.

**Resultados:**
- ✅ `main.py` — Exception handlers globales implementados (3 handlers)
  - `http_exception_handler` — Maneja HTTPException (4xx, 5xx) con logging warning
  - `validation_exception_handler` — Maneja RequestValidationError (422) con detalles formateados
  - `general_exception_handler` — Manejo Exception general (500) con stack trace en logs
- ✅ `main.py` — Logging estructurado configurado
  - Formato: `%(asctime)s | %(levelname)-8s | %(name)s | %(message)s`
  - Output: stdout con timestamps legibles
  - Nivel: INFO por defecto
  - logger dedicado para la aplicación
- ✅ `.env.example` — Documentación exhaustiva con comentarios
  - Secciones organizadas por categoría (Database, ElToque, Security, Scheduler, CORS)
  - Comentarios explicativos para cada variable
  - Valores por defecto y rangos válidos documentados
  - Ejemplos de uso para desarrollo y producción
- ✅ `README.md` — Documentación final completa
  - Requisitos del sistema (mínimos y recomendados)
  - Instalación paso a paso con uv y pip
  - Configuración de variables de entorno
  - 7 endpoints documentados con ejemplos de curl y respuestas JSON
  - Migraciones de base de datos explicadas
  - Testing y comandos útiles
  - Estructura del proyecto detallada
  - Guía de despliegue en producción (systemd, nginx)
  - Solución de problemas comunes
- ✅ Versión actualizada a `1.5.0` en main.py
- ✅ Tag `v1.5.0-fase6` creado

**Criterio de éxito:** ✅ Un desarrollador nuevo puede clonar el repo, copiar `.env`, correr migraciones y levantar el servidor siguiendo solo el README.

---

## 📊 Métricas

| Métrica | Valor |
|---------|-------|
| Total fases | 6 |
| Fases completadas | 6/6 ✅ |
| Progreso total | 100% 🎉 |
| Tests escritos | 58 (28 base + 12 services + 10 rates + 8 admin) |
| Endpoints implementados | 7/7 ✅ |
| Scrapers implementados | 4/4 ✅ |
| Servicio de negocio | ✅ Completo |
| Scheduler | ✅ Corriendo cada 5 min + trackeo de estado |
| Endpoints públicos | ✅ 5 endpoints |
| Endpoints admin | ✅ 2 endpoints (protegidos) |
| CORS configurado | ✅ |
| Auth middleware | ✅ Implementado |
| Exception handlers | ✅ 3 handlers globales |
| Logging estructurado | ✅ Configurado |
| README | ✅ Completo con ejemplos |

---

## 🐛 Issues y Bloqueos

| Fecha | Issue | Estado | Resolución |
|-------|-------|--------|------------|
| — | — | — | — |

---

## 📝 Notas de Desarrollo

### 2026-03-21 - Fase 1 Completada

- [x] Diseño de implementación aprobado
- [x] Plan de Fase 1 creado
- [x] Archivos de seguimiento creados: `PROGRESS.md`, `CONTINUITY.md`
- [x] **Task 1:** Estructura de directorios y archivos base completada
- [x] **Task 2:** Configuración con Pydantic Settings completada
- [x] **Task 3:** Modelos de Base de Datos completados
- [x] **Task 4:** Alembic configurado para migraciones async
- [x] **Task 5:** FastAPI app con endpoint /health completada
- [x] **Task 6:** README documentado
- [x] **Task 7:** Verificación final completada
  - 11 tests pasando
  - Servidor verificado en `http://localhost:8000`
  - Tag `v1.0.0-fase1` creado

**Próximos pasos:** Comenzar Fase 3 — Servicio de Tasas y Scheduler (orquestar scrapers, persistencia en PostgreSQL, APScheduler)

---

### 2026-03-21 - Fase 2 Completada

- [x] Plan de Fase 2 creado: `2026-03-21-taso-api-fase2-scrapers.md`
- [x] **Task 1:** Directorio de scrapers y test utils completado
- [x] **Task 2:** Scraper ElToque completado (5 tests passing)
- [x] **Task 3:** Scraper Binance completado (4 tests passing)
- [x] **Task 4:** Scraper CADECA completado (4 tests passing)
- [x] **Task 5:** Scraper BCC completado (4 tests passing)
- [x] **Task 6:** Test manual y PROGRESS.md actualizado
- [x] 17 tests nuevos pasando
- [x] Tag `v1.1.0-fase2` creado

**Próximos pasos:** Comenzar Fase 3 — Servicio de Tasas y Scheduler (orquestar scrapers, persistencia en PostgreSQL, APScheduler)

---

### 2026-03-22 - Fase 3 Completada

- [x] Plan de Fase 3 creado: `2026-03-21-taso-api-fase3-scheduler.md`
- [x] **Task 1:** Directorio services/ creado
- [x] **Task 2:** `fetch_all_sources()` implementado con paralelismo y timeouts (2 tests)
- [x] **Task 3:** `save_snapshot()` implementado con normalización por fuente (2 tests)
- [x] **Task 4:** `get_latest_rates()` implementado con subquery max(fetched_at) (2 tests)
- [x] **Task 5:** `calculate_change()` implementado con tolerancia 0.0001 (4 tests)
- [x] **Task 6:** `scheduler.py` configurado con APScheduler (2 tests)
- [x] **Task 7:** Scheduler integrado en FastAPI lifespan
- [x] **Task 8:** Verificación final completada
  - 40 tests pasando
  - Scheduler corriendo cada 5 minutos
  - DB con registros de eltoque y cadeca
  - Tag `v1.2.0-fase3` creado y pusheado
- [x] PROGRESS.md actualizado

**Próximos pasos:** Comenzar Fase 4 — Endpoints Públicos (GET /api/v1/tasas/*)

---

### 2026-03-22 - Fase 4 Completada

- [x] Plan de Fase 4 creado: `2026-03-22-taso-api-fase4-endpoints.md`
- [x] **Task 1:** Schemas Pydantic completados (6 schemas en `schemas/rates.py`)
- [x] **Task 2:** Router de Tasas completado (5 endpoints en `routers/rates.py`)
- [x] **Task 3:** CORS configurado en `main.py`
- [x] **Task 4:** Tests de endpoints completados (10 tests nuevos)
- [x] **Task 5:** Verificación final completada
  - 50 tests pasando
  - Endpoints verificados manualmente con curl
  - Swagger UI disponible en `/docs`
  - Tag `v1.3.0-fase4` creado
- [x] PROGRESS.md y CONTINUITY.md actualizados

**Próximos pasos:** Comenzar Fase 5 — Endpoints Admin y Auth (POST /api/v1/admin/refresh, GET /api/v1/admin/status)

---

### 2026-03-22 - Fase 5 Completada

- [x] **Task 1:** `middleware/auth.py` implementado con validación X-API-Key (2 tests)
- [x] **Task 2:** `schemas/admin.py` con 5 schemas Pydantic
- [x] **Task 3:** `routers/admin.py` con 2 endpoints admin (POST /refresh, GET /status)
- [x] **Task 4:** `services/scheduler.py` actualizado para trackear estado en DB
- [x] **Task 5:** Router admin registrado en `main.py` con dependencia de auth
- [x] **Task 6:** 8 tests nuevos escritos y pasando
- [x] **Task 7:** Verificación final completada
  - 58 tests pasando en total
  - Endpoints admin protegidos con API key
  - Scheduler status se actualiza en cada ejecución
  - Tag `v1.4.0-fase5` creado
- [x] PROGRESS.md y CONTINUITY.md actualizados

**Próximos pasos:** Comenzar Fase 6 — Hardening y README (exception handlers, logging, documentación)

---

### 2026-03-22 - Fase 6 Completada

- [x] **Task 1:** Exception handlers globales implementados en `main.py` (3 handlers)
  - `http_exception_handler` — Maneja HTTPException con logging warning
  - `validation_exception_handler` — Maneja RequestValidationError con detalles formateados
  - `general_exception_handler` — Maneja Exception general con stack trace
- [x] **Task 2:** Logging estructurado configurado
  - Formato estructurado con timestamp, nivel, logger y mensaje
  - Output a stdout
  - logger dedicado para la aplicación
- [x] **Task 3:** `.env.example` documentado con comentarios exhaustivos
  - Secciones por categoría (Database, ElToque, Security, Scheduler, CORS)
  - Comentarios explicativos por variable
  - Ejemplos de desarrollo y producción
- [x] **Task 4:** README final completado
  - Requisitos del sistema
  - Instalación paso a paso
  - 7 endpoints documentados con ejemplos
  - Guía de despliegue en producción
  - Solución de problemas comunes
- [x] **Task 5:** Verificación final completada
  - 58 tests pasando
  - Versión actualizada a 1.5.0
  - Tag `v1.5.0-fase6` creado
  - **Push a GitHub completado:** `origin/dev` + tags `v1.4.0-fase5`, `v1.5.0-fase6`
  - PROGRESS.md y CONTINUITY.md actualizados

**Próximos pasos:** Proyecto completado (6/6 fases). Listo para producción.

---

## 🔗 Enlaces Relacionados

- **Plan de Implementación:** `/home/ersus/tasalo/plans/2026-03-21-taso-api-fase1.md`
- **Diseño Original:** `/home/ersus/tasalo/plans/2026-03-21-tasalo-api-design.md`
- **Continuidad del Agente:** `/home/ersus/tasalo/plans/CONTINUITY.md`
- **Repositorio GitHub:** https://github.com/tasalo/taso-api

---

## 🤖 taso-bot — Progreso Detallado

**Repositorio:** `tasalo/taso-bot`
**Stack:** Python 3.12 · python-telegram-bot v21 · httpx · Pillow · pydantic-settings

### ✅ Fase 1 — Diseño Aprobado
**Estado:** **COMPLETADA** ✅
**Fecha:** 2026-03-22

**Objetivo:** Documento de diseño completo con especificaciones visuales y de formato.

**Resultados:**
- ✅ Diseño visual modernizado alineado con TASALO design system
- ✅ Formato de texto mejorado (unicode separators, flag emojis, consistent spacing)
- ✅ Especificación de imagen con colores del design system (`#5b8aff` accent)
- ✅ Fuentes bundeadas: JetBrains Mono + Space Grotesk
- ✅ Diseño de comandos y callbacks definido
- ✅ Documento: `2026-03-22-tasalo-bot-design.md`

**Próximos pasos:** Comenzar Fase 1 de implementación — Scaffold y conexión con taso-api

---

### ✅ Fase 1 — Scaffold y Conexión con el Backend
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v0.1.0-fase1`

**Objetivo:** Bot que arranca y puede hablar con `taso-api`.

**Resultados:**
- ✅ Project scaffold creado con `uv`
- ✅ Configuración con pydantic-settings (4 tests passing)
- ✅ Cliente HTTP asíncrono con httpx (4 tests passing)
- ✅ Entry point del bot con polling (3 handlers: start, tasalo, health)
- ✅ README completo con setup instructions
- ✅ 8 tests passing en total
- ✅ Tag `v0.1.0-fase1` creado y pusheado

**Criterio de éxito:** ✅ El bot está online y la llamada al backend funciona.

**Próximos pasos:** Comenzar Fase 2 — Comando /tasalo con formato de texto modernizado

---

### ✅ Fase 2 — Comando /tasalo (solo texto)
**Estado:** **COMPLETADA** ✅
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v0.2.0-fase2`

**Objetivo:** El bot responde con el texto formateado con diseño modernizado.

**Resultados:**
- ✅ `formatters.py` implementado con 5 funciones principales
  - `build_eltoque_block()`: Bloque mercado informal con emojis de banderas (🇺🇸, 🇪🇺, 🧾, ₮)
  - `build_cadeca_block()`: Bloque CADECA con formato de columnas (Buy/Sell)
  - `build_bcc_block()`: Bloque BCC oficial
  - `build_footer()`: Footer con timestamp y fuentes
  - `build_full_message()`: Combina todos los bloques
- ✅ Separadores unicode modernizados (━, ┈)
- ✅ Indicadores de cambio (🔺 up, 🔻 down, ― neutral)
- ✅ `handlers/tasalo.py`: Handler del comando /tasalo modernizado
- ✅ `main.py` actualizado para usar handler desde handlers/
- ✅ 37 tests nuevos para formatters.py
- ✅ 45 tests passing en total
- ✅ Tag `v0.2.0-fase2` creado y pusheado

**Criterio de éxito:** ✅ `/tasalo` devuelve los 3 bloques de texto formateados correctamente.

**Próximos pasos:** Comenzar Fase 3 — Generador de Imagen Pillow

---

### ✅ Fase 3 — Generador de Imagen Pillow
**Estado:** ✅ COMPLETADA
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v0.3.0-fase3`

**Objetivo:** El comando `/tasalo` envía imagen + texto + botones inline.

**Resultados:**
- ✅ `fonts/`: JetBrains Mono + Space Grotesk descargadas de Google Fonts
- ✅ `image_generator.py`: Generador de imágenes con diseño TASALO
  - Fondo gradiente oscuro (`#09091e` → `#050510`)
  - Línea de acento `#5b8aff` en header y secciones
  - Bloques visuales: ElToque, CADECA, BCC
  - Footer con timestamp y fuentes
  - Timeout 5s con fallback automático a texto
- ✅ `handlers/tasalo.py`: Integración completa
  - `build_inline_keyboard()`: Botones 🔄 Actualizar y 🗺 Ver provincias
  - `send_tasalo_response()`: Envía imagen + texto o fallback texto
  - `tasalo_refresh_callback()`: Actualiza mensaje con datos frescos
  - `tasalo_provincias_callback()`: Muestra tasas provinciales (stub)
  - `tasalo_back_callback()`: Vuelve a vista principal
- ✅ `main.py`: Registro de `CallbackQueryHandler` para botones inline
- ✅ `requirements.txt`: pillow>=11.0, aiohttp>=3.9.0 agregados
- ✅ `tests/test_image_generator.py`: 24 tests nuevos passing
- ✅ 69 tests passing en total (45 anteriores + 24 nuevos)
- ✅ Tag `v0.3.0-fase3` creado y pusheado

**Criterio de éxito:** ✅ `/tasalo` envía imagen generada con Pillow + texto formateado + botones 🔄🗺.

**Próximos pasos:** Comenzar Fase 4 — Callbacks Inline (mejorar provincias, agregar historial)

---

### ✅ Fase 4 — Callbacks Inline (Mejoras)
**Estado:** ✅ COMPLETADA
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v0.4.0-fase4`

**Objetivo:** Los botones del teclado funcionan correctamente.

**Resultados:**
- ✅ `api_client.get_history()` implementado (4 tests)
- ✅ `build_history_message()` formatter (6 tests)
- ✅ `history_callback()` handler (3 tests)
- ✅ `tasalo_refresh_callback()` con indicador visual (2 tests)
- ✅ `tasalo_back_callback()` navegación funcional (2 tests)
- ✅ Handlers registrados en `main.py`
- ✅ 88 tests passing en total
- ✅ Tag `v0.4.0-fase4` creado

**Criterio de éxito:** Botones 🔄 y 🗺 funcionan correctamente desde el mensaje enviado.

**Próximos pasos:** Comenzar Fase 5 — Comandos Admin

---

### ✅ Fase 5 — Comandos Admin
**Estado:** ✅ COMPLETADA
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v0.5.0-fase5`

**Objetivo:** El administrador puede operar el backend desde Telegram.

**Resultados:**
- ✅ `handlers/admin.py` implementado con 2 comandos:
  - `/refresh`: Fuerza refresco inmediato de tasas en el backend
  - `/status`: Muestra estado del scheduler (última ejecución, próximo run, errores)
- ✅ `_is_admin()`: Verificación de permisos por user_id
- ✅ `api_client.admin_refresh()`: POST /api/v1/admin/refresh con X-API-Key (ya implementado)
- ✅ `api_client.admin_status()`: GET /api/v1/admin/status con X-API-Key (ya implementado)
- ✅ Handlers registrados en `main.py`
- ✅ `tests/test_admin_handlers.py`: 11 tests nuevos para admin handlers
- ✅ `tests/test_api_client.py`: 5 tests nuevos para métodos admin de API client
- ✅ 104 tests passing en total (88 anteriores + 16 nuevos)
- ✅ Tag `v0.5.0-fase5` creado

**Criterio de éxito:** ✅ `/refresh` y `/status` funcionan para admins configurados en ADMIN_CHAT_IDS.

**Próximos pasos:** Comenzar Fase 6 — Hardening y README

---

### ✅ Fase 6 — Hardening y README
**Estado:** ✅ COMPLETADA
**Iniciado:** 2026-03-22
**Completado:** 2026-03-22
**Tag:** `v0.6.0-fase6`

**Objetivo:** El bot está listo para producción con error handling, logging y documentación completa.

**Resultados:**
- ✅ `main.py`: Error handler global implementado
  - `error_handler()`: Maneja excepciones de todos los handlers
  - Loguea errores con stack trace completo
  - Notifica al usuario con mensaje amigable
  - Captura chat_id y user_id para debugging
- ✅ `main.py`: Logging estructurado mejorado
  - Formato: `%(asctime)s | %(levelname)-8s | %(name)s | %(message)s`
  - Timestamp con formato legible: `%Y-%m-%d %H:%M:%S`
  - Output a stdout para integración con systemd/journal
  - Nivel configurable vía LOG_LEVEL
- ✅ `.env.example`: Documentación exhaustiva con comentarios
  - Secciones organizadas por categoría (Telegram, Admin, Backend, Timeouts, Logging)
  - Comentarios explicativos para cada variable
  - Ejemplos de configuración para desarrollo y producción
  - Instrucciones para obtener tokens y IDs
- ✅ `README.md`: Documentación completa de producción
  - Requisitos del sistema (mínimos y recomendados)
  - Instalación paso a paso con uv
  - Descarga de fuentes tipográficas
  - 5 comandos documentados con tabla de disponibilidad
  - Botones inline explicados con callbacks
  - Testing y comandos útiles
  - Guía de producción con 3 opciones (systemd, Docker, tmux)
  - Solución de problemas comunes
- ✅ 104 tests passing en total
- ✅ Tag `v0.6.0-fase6` creado

**Criterio de éxito:** ✅ Bot estable con errores logueados, documentación completa para producción.

**Próximos pasos:** taso-bot COMPLETADO (6/6 fases). Listo para producción.

---

## 📝 Notas de Desarrollo — taso-bot

### 2026-03-22 - TASALO-Bot Fase 6 Completada

- [x] **Task 1:** Error handler global implementado en `main.py`
- [x] **Task 2:** Logging estructurado mejorado con formato legible
- [x] **Task 3:** `.env.example` documentado con comentarios exhaustivos
- [x] **Task 4:** `README.md` actualizado con guía de producción completa
- [x] **Task 5:** 104 tests passing (verificación completada)
- [x] **Task 6:** PROGRESS.md y CONTINUITY.md actualizados
- [x] **Task 7:** Tag `v0.6.0-fase6` creado y pusheado
- [x] **Verificación completada:**
  - ✅ 104 tests passing (pytest)
  - ✅ Error handler registra excepciones con stack trace
  - ✅ Logging formato: `YYYY-MM-DD HH:MM:SS | LEVEL | name | message`
  - ✅ .env.example con ejemplos de desarrollo y producción
  - ✅ README con systemd, Docker, tmux deployment guides
  - ✅ Push a GitHub: `origin/dev` + tag `v0.6.0-fase6`

**Próximos pasos:** taso-bot COMPLETADO (6/6 fases, 100%). Listo para producción.

---

### 2026-03-22 - TASALO-Bot Fase 5 Completada

- [x] **Task 1:** `handlers/admin.py` implementado con `/refresh` y `/status`
- [x] **Task 2:** `_is_admin()` para verificación de permisos
- [x] **Task 3:** `api_client.admin_refresh()` y `admin_status()` (ya implementados)
- [x] **Task 4:** Handlers registrados en `main.py`
- [x] **Task 5:** 11 tests nuevos para admin handlers
- [x] **Task 6:** 5 tests nuevos para métodos admin de API client
- [x] **Task 7:** 104 tests passing en total (88 → 104)
- [x] **Task 8:** Commit creado, tag `v0.5.0-fase5` creado y pusheado
- [x] PROGRESS.md y CONTINUITY.md actualizados
- [x] **Verificación completada:**
  - ✅ 104 tests passing (pytest)
  - ✅ `/refresh` funciona para admins (POST /api/v1/admin/refresh)
  - ✅ `/status` muestra estado del scheduler (GET /api/v1/admin/status)
  - ✅ Autorización verifica ADMIN_CHAT_IDS
  - ✅ X-API-Key header enviado correctamente
  - ✅ Push a GitHub: `origin/dev` + tag `v0.5.0-fase5`

**Próximos pasos:** Comenzar Fase 6 — Hardening y README (error handling, logging, .env.example, README)

---

### 2026-03-22 - TASALO-Bot Fase 3 Completada

- [x] Diseño de TASALO-Bot aprobado (2026-03-22)
- [x] Plan de Fase 3 completado: `2026-03-22-taso-bot-fase3-image-generator.md`
- [x] **Task 1:** Fuentes Google Fonts descargadas a `fonts/`
- [x] **Task 2:** `image_generator.py` implementado con diseño TASALO
- [x] **Task 3:** 24 tests para image_generator.py (todos passing)
- [x] **Task 4:** `handlers/tasalo.py` integrado con imagen + texto + botones
- [x] **Task 5:** Teclado inline con botones 🔄 y 🗺
- [x] **Task 6:** Callbacks registrados en `main.py`
- [x] **Task 7:** `requirements.txt` actualizado (pillow, aiohttp)
- [x] **Task 8:** 69 tests passing en total
- [x] **Task 9:** Commit creado, tag `v0.3.0-fase3` creado y pusheado
- [x] PROGRESS.md y CONTINUITY.md actualizados
- [x] **Verificación completada:**
  - ✅ 69 tests passing (pytest)
  - ✅ Fuentes cargan correctamente (JetBrains Mono + Space Grotesk)
  - ✅ Imagen generada: 800px width, altura dinámica (~40KB)
  - ✅ Inline keyboard con callbacks correctos
  - ✅ Timeout 5s con fallback a texto
  - ✅ Push a GitHub: `origin/dev` + tag `v0.3.0-fase3`

**Próximos pasos:** Comenzar Fase 4 — Mejorar callbacks inline (provincias con datos reales, historial)

---

### 2026-03-22 - TASALO-Bot Fase 1 Completada

- [x] Diseño de TASALO-Bot aprobado (2026-03-22)
- [x] Plan de Fase 1 creado: `2026-03-22-taso-bot-fase1-scaffold.md`
- [x] **Task 1:** Estructura de directorios y archivos base completada (commit `45ee5c8`)
- [x] **Task 2:** Configuración con Pydantic Settings completada (commit `2287b28`, 4 tests)
- [x] **Task 3:** Cliente HTTP Asíncrono completado (commit `46c2e1c`, 4 tests)
- [x] **Task 4:** Entry Point del Bot completado (commit `cd6fff6`)
- [x] **Task 5:** README y Verificación Final completados (commit `f458afa`)
- [x] 8 tests pasando en total
- [x] Tag `v0.1.0-fase1` creado
- [x] PROGRESS.md y CONTINUITY.md actualizados

**Próximos pasos:** Comenzar Fase 2 — Comando /tasalo con formato de texto modernizado

---

## 📱 taso-app — Progreso Detallado

**Repositorio:** `TASALO-TEAM/taso-app`
**Stack:** Python 3.12 · Flask · Jinja2 · Tailwind CSS (CDN) · Gunicorn · pydantic-settings
**Ramas:** `main` (principal) | `dev` (trabajo)

---

### ✅ Fase 1 — Scaffold y Templates Base
**Estado:** **COMPLETADA** ✅
**Fecha:** 2026-03-22
**Tag:** `v0.1.0-fase1`

**Objetivo:** Flask server con uv, templates base, design system CSS.

**Resultados:**
- ✅ Project scaffold creado con `uv`
- ✅ `config.py`: pydantic-settings con validación de variables (4 tests)
- ✅ `src/app.py`: Flask app factory con 3 rutas (/, /history, /health)
- ✅ `templates/base.html`: Layout base con Tailwind CDN, Google Fonts, Telegram Web App SDK
- ✅ `templates/index.html`: Vista principal (estructura base)
- ✅ `templates/history.html`: Vista historial (estructura base)
- ✅ `static/css/tasalo.css`: Design system completo
  - Tokens CSS (accent, bg, text, up, down, neutral)
  - Glassmorphism (backdrop-filter blur)
  - Componentes (glass-card, rate-row, indicators)
  - Dark/light mode automático
- ✅ `tests/test_config.py`: 4 tests para configuración
- ✅ `tests/test_app.py`: 3 tests para rutas Flask
- ✅ `README.md`: Documentación completa con setup y deployment
- ✅ 7 tests passing en total
- ✅ Tag `v0.1.0-fase1` creado
- ✅ Push a GitHub: `origin/dev` + tag `v0.1.0-fase1`

**Criterio de éxito:** ✅ Servidor Flask levanta en puerto 5000, health check funciona, templates se sirven correctamente.

**Comandos:**
```bash
# Desarrollo
cd /home/ersus/tasalo/taso-app
source .venv/bin/activate
uv run gunicorn src.app:app --bind 0.0.0.0:5000 --workers 1

# Tests
FLASK_SECRET_KEY=test TASALO_API_URL=http://test:8000 pytest
```

**Próximos pasos:** Comenzar Fase 2 — Vista principal con datos reales de taso-api.

---

## 📝 Notas de Desarrollo — taso-app

### 2026-03-22 - TASALO-App Fase 1 Completada

- [x] Diseño de TASALO-App aprobado (2026-03-22)
- [x] Plan de Fase 1 creado: `2026-03-22-taso-app-fase1.md`
- [x] **Task 1:** Estructura de directorios y requirements.txt (commit inicial)
- [x] **Task 2:** Configuración con pydantic-settings (4 tests passing)
- [x] **Task 3:** Flask app con 3 rutas (3 tests passing)
- [x] **Task 4:** Templates base con Tailwind + Telegram SDK
- [x] **Task 5:** Design system CSS completo (glassmorphism, tokens)
- [x] **Task 6:** Flask routes render templates con API URL injection
- [x] **Task 7:** README completo y verificación final
- [x] 7 tests passing en total
- [x] Tag `v0.1.0-fase1` creado
- [x] PROGRESS.md y CONTINUITY.md actualizados
- [x] **Verificación completada:**
  - ✅ 7 tests passing (pytest: 4 config + 3 app)
  - ✅ Servidor Flask corre en `http://localhost:5000`
  - ✅ `GET /health` devuelve `{"ok": true}`
  - ✅ Templates base con Tailwind CDN y Telegram Web App SDK
  - ✅ Design system CSS con glassmorphism y dark/light mode
  - ✅ README con instrucciones de setup y deployment
  - ✅ Push a GitHub: `origin/dev` + tag `v0.1.0-fase1`

**Próximos pasos:** Comenzar Fase 2 — Vista principal con datos reales (fetch a taso-api, render dinámico, auto-refresh).

---

### ✅ Fase 2 — Vista Principal con Datos Reales
**Estado:** **COMPLETADA** ✅
**Fecha:** 2026-03-22
**Tag:** `v0.2.0-fase2`

**Objetivo:** `/` muestra tasas reales con auto-refresh.

**Resultados:**
- ✅ `static/js/app.js`: JavaScript del cliente implementado
  - `fetchLatest()` → GET `/api/v1/tasas/latest`
  - `renderRates(data)` → puebla DOM con datos
  - `renderChange(change)` → indicador 🔺🔻―
  - `formatRate()` → formatea con decimales apropiados
  - `buildSourceSection()` → construye bloques visuales
  - Auto-refresh cada 60 segundos con `setInterval`
- ✅ `templates/index.html`: Vista principal completada
  - Skeleton loader mientras carga (2 glass cards con shimmer)
  - Error state con botón de reintentar
  - Contenedor de tasas con display dinámico
  - Timestamp de última actualización
  - Botón de refresh manual en header
- ✅ `tests/test_app.py`: 6 tests nuevos para Flask + templates
- ✅ `tests/test_app_manual.js`: 3 test suites para funciones JS (Node.js)
- ✅ 10 tests Python + 3 test suites JS pasando
- ✅ Tag `v0.2.0-fase2` creado

**Criterio de éxito:** ✅ Vista muestra datos reales de la API y se actualiza automáticamente cada 60 segundos.

**Comandos:**
```bash
# Tests Python
FLASK_SECRET_KEY=test TASALO_API_URL=http://test:8000 pytest

# Tests JavaScript
node tests/test_app_manual.js
```

**Próximos pasos:** Comenzar Fase 3 — Vista Historial con Chart.js.
