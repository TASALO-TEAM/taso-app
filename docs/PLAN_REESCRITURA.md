# Plan de reescritura — miniapp TASALO (`taso-app`)

Fecha: 2026-10-09 · Rama: `rewrite/miniapp` · Estado: **borrador para aprobar en G1** · Basado en `docs/AUDITORIA.md` y `docs/TELEGRAM_MINIAPP.md`.
Filosofía: **Funcional → Robusto → Seguro → Útil → Minimalista.**

## 1. Objetivo y alcance

Convertir `taso-app` en la **Telegram Mini App del bot `@tasalobot`**, con la identidad y estructura de `taso-android` (Quiet Glass v3), que reconoce al usuario al abrirla desde Telegram (sin login) y añade lo que Android no puede: **ver, crear, editar y borrar las alertas del usuario** y el **Spotlight diario (`/tspl`)** en el Blog.

Dentro: Tasas (landing), Detalle histórico, Combustible, Calculadora, Blog + Spotlight, Alertas (4 tipos), Ajustes + mensajes del equipo, Admin (`/stats`).
Fuera (esta reescritura): mercado cripto (`/p`, `/spl`, `/news`) — D8; pantalla de provincias (endpoint inexistente, ver D10); modo standalone fuera de Telegram.

## 2. Arquitectura

```
Telegram (WebView)  ──Authorization: tma <initData>──▶  taso-app (Flask, BFF, :5040, /miniapp)
                                                         │  valida initData (HMAC-SHA256, auth_date ≤ 24 h)
                                                         │  user_id SOLO del initData validado
                                                         ├─ datos públicos: caché corta + stale-if-error ──▶ taso-api  (/api/v1/…)
                                                         ├─ alertas/suscripciones: X-API-Key + uid forzado ─▶ taso-api
                                                         └─ Blog: Hive (varios nodos) con caché ≈10 min
```

- **Un solo origen.** El navegador solo habla con `taso-app` (`/miniapp/api/*`); la clave admin nunca llega al cliente. CSP objetivo: `default-src 'none'; script-src 'self' https://telegram.org; style-src 'self'; font-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org` (sin `unsafe-inline`: scripts y estilos en ficheros; si hiciera falta algo en línea, con `nonce`). Fuentes autoalojadas (OFL); sin Tailwind CDN, sin Chart.js, sin Google Fonts.
- **Front:** Flask + Jinja con **una sola plantilla shell** y módulos JS ES propios (sin paso de build), navegación por pestañas en el cliente. Sin framework.
- **Estructura objetivo:**
  `src/app.py` (factory, CSP, errores) · `src/auth/initdata.py` (validación pura) · `src/routes/` (`api_public.py`, `api_alerts.py`, `api_admin.py`, `pages.py`) · `src/services/` (`taso_client.py` con httpx, `hive.py`, `cache.py`, `cuba_time.py`) ·
  `static/css/tokens.css` + `components.css` · `static/js/modules/` (`sdk.js` wrapper único, `api.js`, `store.js`, `rates.js`, `history-math.js`, `charts.js`, `converter.js`, `blog.js`, `markdown.js`, `alerts.js`, `settings.js`, `cuba-time.js`) · `static/fonts/` (Space Grotesk, JetBrains Mono) · `templates/app.html`, `error.html`.
- **Endpoints del BFF (`/miniapp/api`):** `GET me` · `GET rates` · `GET rates/history/summary|daily` · `GET fuel` · `GET year` · `GET messages` · `GET blog/<cuenta>` · `GET image/latest` (condicional) · `GET|POST|DELETE alerts/price` · `GET|PUT|DELETE alerts/image` · `GET|PUT|DELETE alerts/year` · `GET|POST|DELETE alerts/tspl[/<hora>]` · `GET admin/stats` (solo `ADMIN_CHAT_IDS`) · `GET /health` (sin auth). Todas con `Authorization: tma <initData>` salvo `/health`; límite por usuario en memoria.
- **Identidad:** `user_id` solo de `initData` validado. Nunca de `initDataUnsafe`, URL o cuerpo. Los `uid` que el cliente envíe se ignoran. Sin `initData` válido → pantalla «Ábrela desde @tasalobot».
- **Variables nuevas (`.env.example`):** `TELEGRAM_BOT_TOKEN`, `ADMIN_CHAT_IDS`, `INITDATA_MAX_AGE` (24 h), `TASALO_ADMIN_KEY` (sustituye a `ADMIN_API_KEY`, mismo valor que el del bot/API; se acepta el nombre viejo con aviso de obsolescencia durante una versión), `TASALO_BASE_PATH`.
- **Prefijo `/miniapp`:** URLs relativas o `TASALO_BASE_PATH`, con test.
- **Estados globales de UI:** cargando · vacío · error · sin conexión · no identificado · datos desactualizados («actualizado hace X» con `fetched_at`).

## 3. Decisiones abiertas (recomendación para cada una)

| ID | Decisión | Recomendación | Por qué / coste |
|---|---|---|---|
| **D1** | Dónde se valida `initData` | **BFF en `taso-app`** | Un solo sitio sin tocar `taso-api`; el token del bot ya vive en el mismo VPS; el BFF llama a la API con la clave admin y fuerza el `uid`. Alternativa (en `taso-api`) obliga a cambiar y desplegar la API para cada pantalla. |
| **D2** | Frontend y ruta de datos | **Flask + Jinja + módulos JS propios; todo por el BFF** (incluidos los datos públicos, con caché) | `connect-src 'self'`, caché y «servir lo último si falla», y el Blog (Hive) ya necesita el BFF. Coste: un salto extra. Sin SPA ni build. |
| **D3** | Navegación | **5 pestañas: Tasas · Combustible · Calculadora · Blog · Alertas.** Ajustes con el `SettingsButton` de Telegram + engranaje en cabecera; campana para mensajes del equipo | Android usa Ajustes como 5.ª pestaña; aquí Alertas es lo diferencial. Se valida en maqueta (G2). |
| **D4** | Precio actual para crear alertas de precio | **Reutilizar `latest.binance` (20 monedas) en la v1**, sin endpoint nuevo; endpoint de precios solo si se quieren más monedas | Cero cambios de API. Riesgo: el dato puede tener hasta 15 min y el checker usa `price_at_creation` para detectar cruces; la UI muestra la hora del precio. Pregunta para G1 abajo. |
| **D5** | Gráficos | **SVG propio** (sparkline + línea con rango), matemática en `history-math.js` con tests | Sin dependencia, pesa poco, mismo enfoque que Android (Canvas). Se retira Chart.js. |
| **D6** | Rama y corte | **`rewrite/miniapp`; un corte único tras G2 + S0–S6** (S7–S9 pueden ir en la misma rama antes del merge) | La miniapp vieja sigue en producción hasta el merge; sin `push`/deploy mío. |
| **D7** | Horas UTC frente a hora de Cuba | **La UI muestra y pide hora de Cuba (`America/Havana`) y guarda en UTC** para año/Spotlight (contrato actual); para imagen guarda `HH:MM` tal cual el bot | Cuba cambia UTC−5/−4. Ahora (oct) es UTC−4 hasta el 1 nov. Los presets del bot 11/17/23 UTC = 7 AM/1 PM/7 PM de verano. Al cambiar de horario el envío se mueve 1 h salvo que se guarde de nuevo: se avisa con una línea («horario de verano en Cuba») y la conversión usa la fecha actual, no un offset fijo. Pendiente: confirmar que el envío de imagen usa hora de Cuba. |
| **D8** | Mercado cripto en la miniapp | **Evaluar y no construir** (como indica el prompt) | Los datos de `/p`, `/spl`, `/news` vienen del bot (CoinGecko/CMC/Groq), no de `taso-api`; haría falta API nueva. |
| **D9** | Almacenamiento de ajustes | **`CloudStorage` para ajustes (clave única `tasalo_settings`, JSON < 4096 caracteres) + `DeviceStorage` para caché; con respaldo `localStorage` si el cliente es < 6.9/9.0.** Migración en el primer arranque: se lee `localStorage` (`SETTINGS_KEY`), se copia a `CloudStorage` y se marca migrado | Ajustes sincronizados entre dispositivos sin perder los actuales. |
| **D10** | `/imagen` y `/provincias` | **`/provincias`: se retira** (el endpoint da 404 y el botón del bot está comentado). **`/imagen`: subvista de Tasas** («Ver imagen de El Toque») que solo aparece si `images/eltoque/file/latest` responde 200 | Evita una pantalla rota; la imagen sigue accesible sin ocupar una pestaña. |

**Pregunta para ti (G1) — D4:** ¿vale reutilizar el precio de Binance de `taso-api` (≤ 15 min) para fijar `price_at_creation`, o prefieres un endpoint de precio en vivo en `taso-api`?

## 4. Secciones, orden y criterio de «hecho»

Cada sección es una rebanada completa: UI + datos + estados + tests + handoff actualizado. Antes de S0 se hace F4 (diseño y maquetas, G2).

| Sección | Contenido | Criterio de «hecho» |
|---|---|---|
| **S0 Cimientos** | `initData` + `GET /me`; wrapper único del SDK (`ready()` una sola vez, guardas por versión); tokens CSS claro/oscuro + test de contraste; shell con barra flotante; estados globales; CSP endurecida; fuentes locales; pantalla «Ábrela desde @tasalobot»; retirada del modo standalone y de Tailwind/Chart.js/Google Fonts | Tests Python: initData válido, manipulado, expirado, sin `hash`, `user` mal formado, con `signature`. Test de contraste (WCAG 4,5:1 texto, 3:1 UI) en ambos temas. Abrir fuera de Telegram no lanza errores. `curl` de cabeceras muestra la CSP sin `unsafe-inline` |
| **S1 Tasas** | Selector de fuente (El Toque, QvaPay, BCC, CADECA); tarjetas/lista; ▲▼ y % (convención sube rojo/baja verde, invertible); compra/venta; año y frase del día; botón condicional de imagen de El Toque | Orden de monedas por fuente como Android; «sin dato» sin interpolar; marca «actualizado hace X» por fuente y aviso de datos viejos; funciona al 200 % de fuente |
| **S2 Detalle histórico** | Overlay con `BackButton`; rangos 7D/30D/90D/6M o fechas; lista de 7/14/30 días; sparkline de 30 días en tarjetas; QvaPay «historial corto» | `history-math.js` con `node --test` (día = fecha de Cuba, precio más cercano a las 7:00, sin interpolar); los días sin dato no aparecen; usa `history/summary` y `history/daily` (ya en producción) |
| **S3 Combustible** | Petróleo, B-94, B-83, B-90 con compra/venta; aviso de desactualizado | Con la incidencia abierta se ve el aviso; depende de **C-API-3** para medir la edad real del dato (hasta entonces, mensaje prudente «sin marca de actualización») |
| **S4 Calculadora** | Conversión con pivote CUP (El Toque/BCC/CADECA) o USD con tabla `1/rate` (QvaPay); `monto × tasa(origen) / tasa(destino)`; recibo para copiar; compartir con `switchInlineQuery`/`openTelegramLink`; descargar con `downloadFile` | Se portan **los casos de `ConverterTest.kt`** a `node --test`; pruebas de redondeo y monedas faltantes; la descarga solo si `isVersionAtLeast('8.0')` y las cabeceras `Content-Disposition`/CORS están en el endpoint del recibo |
| **S5 Blog + Spotlight** | Pestañas `@tasalo` y `@ersusoficial`; tarjeta «Spotlight de hoy» (post más reciente de `@tasalo` cuyo **título recortado** empiece por `📊 TASALO Spotlight —` o cuyo permlink cumpla `^tasalo-spotlight-\d{2}-[a-z]{3}-\d{4}$`); lista; lector Markdown **sanitizado** (sin HTML crudo, solo imágenes https, enlaces por `openLink`); Hive vía BFF (`bridge.get_account_posts`, `sort: posts`, `limit: 10`, nodos de respaldo, caché ≈10 min, sirve caché si falla); «Recibir cada día» que abre la alerta `/tspl`; «Abrir en Ecency» | Tests del sanitizador (script, iframe, `javascript:`, `data:`, HTML crudo, imagen http); detección de Spotlight con los 10 títulos reales incluido el de espacio inicial; fallo de un nodo no rompe la pantalla |
| **S6 Alertas** | Resumen de los 4 tipos (activa/pausada/sin configurar); lista de alertas de precio con borrar y editar; formularios con `MainButton`+`showProgress`, `showConfirm` al borrar, `HapticFeedback`, `enableClosingConfirmation` con cambios sin guardar; `requestWriteAccess` si `allows_write_to_pm` falta | Pruebas de autorización: el BFF ignora cualquier `uid` del cliente y no puede leer ni borrar alertas de otro; `POST` precio crea ABOVE y BELOW; «editar» = borrar+crear; Spotlight máx. 2 horarios (409 mostrado como mensaje claro); horas en Cuba ↔ UTC con test de cambio de horario (D7) |
| **S7 Ajustes + mensajes del equipo** | Tema, vista tarjetas/lista, convención sube/baja, fuente por defecto, monedas visibles, `addToHomeScreen`, versión; mensajes de `GET /app/messages` (campana) | Migración desde `localStorage` sin perder valores (test); sincroniza por `CloudStorage`; mensajes con estado leído local |
| **S8 Admin** | `/stats` y lo que ya existe, solo con `user.id ∈ ADMIN_CHAT_IDS`; se retira el login por clave | Un no admin recibe 403; la clave admin no aparece en ninguna respuesta |
| **S9 Cierre técnico** | Rendimiento, accesibilidad, 200 % de fuente, `LOW` performance class, README, CHANGELOG, versión única | Lista de verificación de la skill (`pro-rules.md`) revisada; README sin cifras viejas; `version.txt` único |

## 5. Contratos de alertas (verificados en el código de `taso-api`; ver `AUDITORIA.md` §7)

| Tipo | Endpoints `/api/v1` | Campos / reglas | Auth con la que lo llama el BFF |
|---|---|---|---|
| Precio cripto | `GET /alerts/{uid}`, `POST /alerts`, `DELETE /alerts/{id}` | `coin`, `target_price>0`, `price_at_creation>0`, `note≤120`; crea ABOVE y BELOW | `X-API-Key` (ya la exige la API) |
| Imagen El Toque | `GET/POST /images/alerts[/{uid}]`, `DELETE /images/alerts/{uid}`, `POST …/disable` | `alert_time "HH:MM"`, `format_type photo\|document`, `enabled`; default unificado **07:30** | `X-API-Key` tras **C-API-1** |
| Año y frase | `GET/POST/DELETE /year/subscriptions/me/{uid}` | `hour` 0–23 UTC; un horario | `X-API-Key` tras **C-API-2** |
| Spotlight | `GET/POST /tspl/subscriptions/me/{uid}`, `DELETE …/{uid}[/{hour}]` | `hour` UTC; máx. 2 (409 `max_subscriptions_reached`); `user_id` también en el cuerpo → el BFF lo fuerza | `X-API-Key` tras **C-API-2** |

## 6. Cambios requeridos en otros repos (a aprobar en bloque en G1; no se tocan antes)

**`taso-api`** (primero, siempre antes del bot):
- **C-API-1 (alto).** Exigir `X-API-Key` en `/api/v1/images/alerts*` (hoy públicos; `GET /images/alerts` filtra todas las alertas). Cambiar el default de `alert_time` del esquema a `07:30`.
- **C-API-2 (alto).** Exigir `X-API-Key` en los `me/{uid}` de `/year` y `/tspl`. El cliente del bot ya pone `X-API-Key` en sus cabeceras por defecto (`taso-bot/src/api_client.py:65`); **[?] verificar** que las llamadas de `image_alerts.py` y las de año/Spotlight usan ese cliente para no romper el bot en producción.
- **C-API-3 (medio).** Exponer `fetched_at` real del combustible (p. ej. `sources_updated_at.fuel` en `latest` y `fetched_at` en `/tasas/fuel`); hoy `updated_at` coincide con la hora de la consulta y no sirve para detectar datos viejos.
- **C-API-4 (bajo).** `hmac.compare_digest` en `middleware/auth.py`.
- **C-API-5 (opcional).** Endpoint de precio de monedas en vivo, solo si se rechaza D4.

**`taso-bot`**:
- **C-BOT-1.** Unificar la hora por defecto de la alerta de imagen en 07:30 (`image_alerts.py:405`).
- **C-BOT-2.** Botones `web_app` con `?tab=` en `/alert`, `/tspl` y `/y` (enlaces profundos) y, cuando salga de mantenimiento, en `/toqueimg`.
- **C-BOT-3 (opcional).** Menú del bot con `setChatMenuButton`; **BotFather:** activar Main Mini App (`https://t.me/tasalobot?startapp`).

**Despliegue (lo haces tú):** `git pull` + `systemctl restart` de `taso-api`, `taso-bot` y `taso-app`; sin cambios en Caddy (el bloque `/miniapp` → `:5040` ya existe); añadir las variables nuevas al `.env` de `taso-app`.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| El BFF pasa a tener el token del bot y la clave admin | Solo en `.env` del servidor; logs sin `initData`; respuestas sin cabeceras ni claves; tests |
| `signature` en `initData` y el cálculo del hash | Probar con un `initData` real en S0 antes de dar por buena la validación |
| CSP sin `unsafe-inline` rompe plantillas actuales | Se reescribe sin scripts/estilos en línea; `nonce` si hiciera falta |
| Cambios C-API-1/2 rompen al bot si algún cliente no manda la clave | Verificar en el bot antes de aplicar; orden API → bot; despliegue conjunto |
| Hive o sus nodos caen | Varios nodos, caché ≈10 min, mostrar lo último si falla |
| Combustible desactualizado sin forma de medirlo (C-API-3) | Mensaje prudente hasta que exista `fetched_at` |
| Cambio de horario de Cuba mueve los envíos 1 h | Aviso en la UI; conversión con la fecha actual |
| Desfase con Android (indicador compara con la lectura anterior de 15 min) | Se documenta igual en la UI («vs. lectura anterior») |
| Sin SSH ni pytest local | Compilar con `py_compile`, tests JS locales con `node --test`; pytest completo lo corres en el VPS |
| Herramientas locales que se cuelgan | Comandos acotados, `Select-Object -First`, sin globs recursivos grandes |

## 8. Calidad y pruebas
- `pytest` (BFF: initData, autorización por usuario, proxy, caché, errores) y `node --test` (conversor, historial, parseo de `initData` en cliente, sanitizador Markdown, migración de ajustes, hora Cuba↔UTC, contraste). Nada de lógica de negocio dentro de plantillas.
- Commits Conventional por repo, comandos separados; el hook de versión sube `version.txt`; `.claude/` no se commitea.
- Docs: `HANDOFF_AGENTE.md` se actualiza al terminar cada paso; README y CHANGELOG al cierre.

## 9. Qué necesito de ti en G1
1. **Aprobar el plan** (arquitectura, secciones, D1–D10) o decirme qué cambiar.
2. **D4:** ¿Binance de `taso-api` (≤ 15 min) para `price_at_creation` o endpoint en vivo?
3. **Cambios C-API-1…4 y C-BOT-1…3:** ¿aprobados en bloque? Si sí, los hago **después de G2**, API primero y bot después, sin desplegar.
4. **BotFather** (Main Mini App y menú): lo haces tú cuando quieras; no bloquea nada.
Tras G1 sigo con F4 (sistema de diseño y maquetas) y me detengo en G2.

---

## Reajuste 2026-10-12: Perfil, Ajustes y Admin (leer `docs/PLAN_PERFIL.md`)
Por orden de Ernesto la pestaña **Alertas** pasó a ser **Perfil** y cambian estas filas de la tabla de secciones:
- **S6 Alertas (pestaña):** hecha, pero ahora vive en Perfil → «Mis avisos» (`views/perfil.js` monta `views/alertas.js`). `#/alertas` y `tab_alertas` son alias.
- **S7 Ajustes + mensajes:** sustituida por **P3 Ajustes** (icono de engranaje en Perfil → `#/ajustes`) y **P5 Novedades** (dentro de Ajustes).
- **S8 Admin:** sustituida por **P4**: estadísticas del bot y de la app dentro de Perfil, solo para ids admin; la vieja `/stats` con clave se retira.
- **F4 (alertas de precio propias de S10):** su UI va en Perfil → «Mis avisos»; se hace después de P4.
- **Contratos nuevos:** `GET /api/me` ampliado (`username`, `last_name`, `photo_url`, `is_premium`) y `GET /api/admin/overview` (solo admin). Orden pendiente: P3 → P4 → P5 → F4 → S9 → F6.
