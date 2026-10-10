# Auditoría F1 — reescritura de la miniapp TASALO

Fecha: 2026-10-09 (hora de Cuba). Rama `rewrite/miniapp`. Verificado leyendo código real y haciendo `GET` de solo lectura al VPS (`tasalo.duckdns.org`). Marcas: **[V]** verificado · **[R]** refutado/corregido · **[?]** pendiente de verificar.

## 1. Miniapp actual (`taso-app`)

**Stack y despliegue [V].** Flask 3 + Jinja, `WsgiToAsgi` (`src/app.py:~113`), uvicorn puerto 5040 (`config.py`: `port=5040`). Dependencias en `requirements.txt` (flask 3.1.3, httpx, pydantic-settings, uvicorn, gunicorn).

**Rutas (`src/app.py`) [V].** `/` index · `/history` · `/provincias` · `/settings` · `/imagen` · `/alerts` · `/stats` · `/stats/login` (GET/POST) · `/stats/logout` · `/api/stats` · `/health`. Handlers 404/500 (JSON si empieza por `/api/`).

**Tamaño del código [V].** `static/js/app.js` 1819 líneas · `static/css/tasalo.css` 1231 · `static/js/telegram-miniapp.js` 431 · plantillas: `alerts` 321, `imagen` 256, `settings` 226, `stats` 249, `error` 163, `history` 118, `index` 103, `provincias` 90, `base` 90, `stats_login` 68. Tests: `tests/test_app.py`, `test_config.py`, `test_errors.py`, `test_logging_config.py`, `test_settings.py`, `test_app_manual.js`, `test_telegram_miniapp.js`.

**Qué consume cada pantalla [V].**
- Tasas/Historial/Provincias (`app.js`): `GET /api/v1/tasas/latest` (l.103, 167), `/tasas/history` (l.134), `/tasas/provincias` (l.151), `/tasas/history/local` (l.880). Directo del navegador a `TASALO_API_URL` (inyectada en `base.html`).
- Imagen (`imagen.html:216`): `/api/v1/images/eltoque/file/latest`.
- Alertas (`alerts.html:154-330`): solo alertas de imagen, `GET/POST/DELETE /api/v1/images/alerts[/{uid}]`. **No gestiona** alertas de precio, año/frase ni Spotlight.
- Stats: `/api/stats` hace proxy a `/api/v1/admin/stats/summary` con `X-API-Key` desde el servidor (bien: la clave no llega al navegador).

**Identidad [V].** No hay identificación en el servidor. `alerts.html:154` solo envía `X-Init-Data` como header; el `user.id` sale de `initDataUnsafe` en el cliente (`telegram-miniapp.js:462-463`) y viaja en URL/cuerpo. `taso-api` **no valida** `X-Init-Data` (cero coincidencias de `init_data`/`X-Init` en `taso-api/src`).

**Hallazgos de deuda y riesgo [V].**
1. `base.html` usa `window.Telegram.WebApp` sin comprobar (revienta fuera de Telegram); `telegram-miniapp.js:59-65,148` tiene modo standalone aparte → dos caminos para lo mismo.
2. CSP (`base.html:5`): `script-src 'unsafe-inline'` + `cdn.tailwindcss.com` + `cdn.jsdelivr.net`; `connect-src` solo `tasalo.duckdns.org`, `cdn.jsdelivr.net` y `localhost:*` → el Blog (Hive) no cabe sin cambiarla o sin proxy.
3. Tailwind por CDN, Chart.js sin versión fijada (`cdn.jsdelivr.net/npm/chart.js`), Space Grotesk/JetBrains Mono desde Google Fonts.
4. `maximum-scale=1.0, user-scalable=no` en el viewport: impide el zoom (accesibilidad) y choca con la prueba al 200 %.
5. Ajustes en `localStorage` (`app.js:1393,1421`, `SETTINGS_KEY`); no sincronizan entre dispositivos. Ticker de Binance (`app.js:34-260,1322-1331`) con lista de 20 monedas.
6. Login de `/stats` con clave compartida en sesión Flask (`src/app.py:68-80`); `session` con `FLASK_SECRET_KEY`. Comparación `api_key == settings.admin_api_key` sin `hmac.compare_digest`.
7. Hora por defecto de la alerta de imagen: `alerts.html:42,207,219` usa **07:15**.
8. README desfasado: badge `version-0.11.0--grid--layout` (README l.5) frente a `version.txt` = **0.1.2.1**.
9. `.env.example` contiene `ADMIN_API_KEY`; el bot usa `TASALO_ADMIN_KEY` para el mismo valor → hay que unificar (D del plan).
10. `config.py`/`.env.example` con comentarios mojibake (encoding): cosmético.

## 2. Bot (`taso-bot`)

- **Botón de la miniapp [V].** `src/handlers/start.py:24` `MINIAPP_URL = "https://tasalo.duckdns.org/miniapp"`; l.75 botón «Abrir TASALO Web» con `WebAppInfo`. Es el único `web_app` del bot hoy.
- **Admin [V].** `ADMIN_CHAT_IDS` (`src/core/config.py:11-15` y `src/config.py` `admin_chat_ids`/`get_admin_chat_ids_list`); clave admin `tasalo_admin_key` (`src/config.py:38`, “mismo valor que ADMIN_API_KEY en taso-api”) usada en `main.py:167`, `tspl.py:50`, `y.py:31`.
- **Inconsistencia de hora de imagen [V].** `image_alerts.py:67` default `"07:30"` al crear; `image_alerts.py:405` fallback `"07:15"` al leer; `daily_image_sender.py:30-31` `IMAGE_CAPTURE_TIME`/`MIN_SEND_TIME` = `07:30`. La miniapp usa 07:15. Unificar en **07:30** (el bot no envía antes de esa hora).
- **Spotlight [V].** `src/handlers/tspl.py`: plantilla de blog `# 📊 TASALO Spotlight — {fecha}` (l.257; el carácter es raya larga U+2014); `_build_blog_content` en l.233. En Hive los títulos reales son `📊 TASALO Spotlight — 09 oct 2026` y el permlink `tasalo-spotlight-DD-mmm-YYYY`.

## 3. API (`taso-api`, `src/main.py:244-257`, `src/routers/`)

Autenticación: `require_auth` (`src/middleware/auth.py`) valida solo `X-API-Key` frente a `ADMIN_API_KEY` (compara con `!=`, no en tiempo constante). **Ningún router valida `X-Init-Data`** [V].

| Prefijo | Endpoint | Acceso | Notas |
|---|---|---|---|
| `/api/v1/tasas` | `GET /latest`, `/eltoque`, `/cadeca`, `/bcc`, `/qvapay`, `/fuel`, `/cubanomic`, `/provincias`* | público | `qvapay` y `fuel` responden 200 en producción [V] |
| `/api/v1/tasas` | `GET /history`, `/history/daily`, `/history/summary`, `/history/local`, `/history/cubanomic` | público | `daily` y `summary` **ya desplegados** en el VPS (200) [V] |
| `/api/v1/alerts` | `GET /{uid}`, `POST ""`, `DELETE /{id}`, `DELETE /user/{uid}`, `GET /active[/coins]`, `PATCH /{id}/trigger` | **X-API-Key** (401 sin clave [V]) | No hay `PUT`: «editar» = borrar y crear |
| `/api/v1/images` | `GET /alerts/{uid}`, `POST /alerts`, `DELETE /alerts/{uid}`, `GET /alerts`, `POST /alerts/{uid}/disable`, `GET /eltoque/latest`, `/eltoque/file/latest`, `POST /eltoque/capture` | **público, sin clave** | `GET /alerts` devuelve alertas de **todos** los usuarios (200 con datos en producción [V]) |
| `/api/v1/year` | `GET /state`, `/quotes[/today|/stats]`, `GET/POST/DELETE /subscriptions/me/{uid}` | público (`me/{uid}`) | admin: `/subscriptions`, `/extra-flag`, `/quotes` con clave |
| `/api/v1/tspl` | `GET/POST /subscriptions/me/{uid}`, `DELETE /subscriptions/me/{uid}[/{hour}]` | público | `GET /subscriptions` (todas) con clave |
| `/api/v1/app` | `GET /messages` | público (200 [V]) | admin con clave |
| `/api/v1/admin` | `/refresh`, `/status`, `/db/*`, `/stats/*` | X-API-Key | `/stats/summary` es el que usa la miniapp |
| `/api/v1/ads`, `/tickets` | — | `ads` activos públicos; `tickets` con clave | fuera del alcance de la miniapp |

\* `/provincias` aparece en `app.js:151`; confirmar ruta exacta en `rates.py` (no estaba en el barrido de decoradores).

### Hallazgos de seguridad en `taso-api` (a proponer en «Cambios requeridos»)
1. **S-API-1 (alto).** `/api/v1/images/alerts/*` sin autenticación: cualquiera lista, crea, borra o desactiva alertas ajenas. `GET /api/v1/images/alerts` filtra los datos de todos.
2. **S-API-2 (alto).** `/api/v1/year/subscriptions/me/{uid}` y `/api/v1/tspl/subscriptions/me/{uid}` públicos con `uid` en la ruta: cualquiera toca la suscripción de otro.
3. **S-API-3 (medio).** Ningún endpoint de usuario valida `initData`. Opción del plan: la miniapp valida `initData` y llama con la clave admin forzando el `uid` (BFF); el bot ya usa la clave admin.
4. **S-API-4 (bajo).** `require_auth` compara la clave con `!=`; usar `hmac.compare_digest`.
5. CORS: `allow_headers=["*"]` con `allow_origins` configurable (`main.py:213-217`); revisar que incluya solo orígenes necesarios cuando los datos públicos pasen por el BFF.

## 4. Android (`taso-android`) — fuente de diseño y lógica

Tomado de `docs/HANDOFF_AGENTE.md` (leído completo) y `docs/ESCALADO_DE_FUENTE.md`; [?] pendiente leer `Theme.kt`, `ConverterTest.kt`, `HISTORIAL_DE_PRECIOS.md` y `CHANGELOG.md` en F3/F4.
- 5 secciones en pager: Tasas · Combustible · Calculadora · Blog · Ajustes, con `GlassIslandBar`; overlays de Notificaciones y Detalle histórico.
- Quiet Glass v3: turquesa `#3DD6C0` sobre `#0E1621`; tarjetas `#16212F`; sube rojo / baja verde (invertible). Paleta clara en `ui/theme/Theme.kt` [?]. `ContrastTest` exige WCAG.
- Historial: día = fecha America/Havana; precio = lectura más cercana a las 7:00; sin interpolar. Endpoints `history/summary` y `history/daily` ya existen en producción.
- Escalado de fuente: respetar el tamaño del sistema; alturas con mínimos, no fijas; probar 85/100/130/150/200 %.
- Pendiente de Android que afecta aquí: el indicador de cambio compara con la lectura anterior (15 min), no con «ayer»; en la miniapp definir lo mismo explícitamente.

## 5. Datos frescos / combustible
- `GET /api/v1/tasas/fuel` responde 200 en producción; la incidencia de combustible (la API se reinició y sus tasas no se actualizaban) obliga a mostrar siempre «actualizado hace X» con `fetched_at` y un aviso de datos desactualizados pasado un umbral [V por el prompt; umbral por definir en el plan].
- Ciclo de refresco de la API: 15 min (`REFRESH_INTERVAL_MINUTES`); umbral sugerido para «desactualizado»: > 45 min en tasas, definir en F3.

## 6. Pendiente de verificar (siguiente en F1/F3)
- [?] Esquemas exactos de `POST /alerts` (campos `coin`, `target_price`, `price_at_creation`, `note`) y de `year`/`tspl` (`hour` UTC, máx 2, 409 `max_subscriptions_reached`) leyendo `src/schemas/`.
- [?] Ruta exacta de `/provincias` y forma de `/tasas/latest` (claves por fuente).
- [?] Contenido de `Theme.kt`, `ConverterTest.kt`, `HISTORIAL_DE_PRECIOS.md`, `CHANGELOG.md`.
- [?] Plantillas `history`, `provincias`, `imagen`, `settings` y `stats` en detalle (qué lógica de `app.js` reutilizar).
- [?] Tests existentes: qué cubren y cuáles sobreviven a la reescritura.

## 7. Verificaciones cerradas (2026-10-09, fin de F1)

### Confirmaciones y correcciones a los hallazgos del prompt
| Hallazgo del prompt | Resultado |
|---|---|
| Flask + Jinja + WsgiToAsgi, puerto 5040, bajo `/miniapp` | **[V]** |
| Sin identificación en servidor; `alerts.html` toma `uid` del cliente | **[V]** |
| `taso-api` no valida `X-Init-Data` | **[V]** (cero coincidencias) |
| `base.html` usa `Telegram.WebApp` sin comprobar y hay dos caminos (standalone) | **[V]** |
| CSP: `connect-src` solo `tasalo.duckdns.org` | **[V]** (+ jsdelivr y localhost) |
| README en v0.11.0 frente a `version.txt` 0.1.2.1 | **[V]** |
| Botón «Abrir TASALO Web» en `/start` con `MINIAPP_URL` | **[V]** (`start.py:24,75`) |
| Hora por defecto: miniapp 07:15, bot 07:30 | **[V] y ampliado**: hay **tres** valores: miniapp 07:15, bot 07:30 al crear (`image_alerts.py:67`), fallback 07:15 al leer (`image_alerts.py:405`) y default del esquema de la API 07:15 (`schemas/image.py`, `ImageAlertCreate.alert_time`) |
| Título Spotlight `📊 TASALO Spotlight —` | **[V]** en bot (U+2014) y en Hive (10 posts reales leídos). Algún título trae espacio inicial: la detección debe recortar. Más robusto: permlink `tasalo-spotlight-DD-mmm-YYYY` |
| Endpoints `daily`/`summary` desplegados en el VPS | **[V]** (200) |
| El bot tiene botón «Ver provincias» | **[R]** El botón está **comentado** (`tasalo.py:52-53`, `# TODO: Habilitar cuando la API tenga datos de provincias`) y el callback es un stub |
| La miniapp muestra provincias | **[R] roto**: `app.js:151` pide `/api/v1/tasas/provincias` y el VPS responde **404**; `taso-api/src` no contiene esa ruta. La pantalla `/provincias` hoy no funciona |

### Contratos de alertas verificados en `taso-api/src/schemas`
- Precio (`alert.py`): `AlertCreateSchema{user_id, coin(2–20, mayúsculas), target_price>0, price_at_creation>0, note≤120}`; respuesta con `condition ABOVE|BELOW`, `status ACTIVE|TRIGGERED`, `triggered_at`. Un `POST` crea dos alertas (ABOVE y BELOW) según el prompt. [?] confirmar en `routers/alerts.py:99-140` al implementar S6.
- Imagen (`image.py`): `{user_id, alert_time "HH:MM", format_type photo|document, enabled}`.
- Año (`year.py`): `SubscriptionCreate{hour 0–23}`; respuesta `{hour}`; un solo horario.
- Spotlight (`tspl.py`): `TsplSubscriptionCreate{user_id, hour 0–23}`; **el cuerpo trae `user_id` además del de la ruta** → riesgo extra de suplantación; máximo `MAX_SUBSCRIPTIONS_PER_USER` (409 `max_subscriptions_reached`). Horas en UTC.
- `GET /api/v1/tasas/latest` → `{ok, data{eltoque, cadeca, bcc, binance, qvapay}, updated_at, sources_updated_at}`. Monedas: El Toque `BTC,EUR,MLC,TRX,USD,USDT`; CADECA `CAD,CHF,CUP,EUR,GBP,JPY,MXN,USD`; BCC `AUD,CAD,CHF,EUR,GBP,JPY,MXN,RUB,USD`; QvaPay llaves `CUP,MLC,TROPIPAY,ETECSA,ZELLE,CLASICA,BOLSATM,BANDECPREPAGO` (son **métodos de pago**, no monedas: la miniapp debe decidir cómo mostrarlos). `fuel` no viene en `latest`: se pide aparte.

### Lo que queda para F3/F4 (no bloquea el plan)
- Leer completo `Theme.kt`, `ConverterTest.kt`, `HISTORIAL_DE_PRECIOS.md`, `CHANGELOG.md` de Android (F4 y S4).
- Inspección detallada de `app.js` por módulos para decidir qué se reutiliza (el plan lo asume: `telegram-miniapp.js`, gráficos y `/stats`).
- Cobertura de los tests actuales (`test_app.py` 230 líneas, `test_telegram_miniapp.js` 224).
