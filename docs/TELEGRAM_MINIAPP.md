# Telegram Mini Apps — lo que aplica a TASALO (F2)

Fuente: https://core.telegram.org/bots/webapps (leída completa el 2026-10-09; última nota de cambios: Bot API 10.1, 11 jun 2026) y https://core.telegram.org/bots/serverless. Solo se anota lo que usa la miniapp. «Mín.» = versión mínima de Bot API; el cliente la expone en `Telegram.WebApp.version` y se comprueba con `Telegram.WebApp.isVersionAtLeast('x.y')`.

## 1. Cómo se abre y qué recibe

- Script del SDK en `<head>`, **antes de cualquier otro script**: `https://telegram.org/js/telegram-web-app.js?64` (la doc lo muestra con `?64`). La CSP debe permitir `https://telegram.org` en `script-src`.
- Formas de abrir que usará TASALO (todas dan `initData` con usuario, `query_id` y tema):
  - **Botón inline `web_app`** (ya existe en `/start`): `src/handlers/start.py:75`.
  - **Botón de menú del bot** (`setChatMenuButton` o BotFather → Menu Button): misma conducta que el botón inline. **Requiere cambio en el bot o BotFather (a aprobar en G1).**
  - **Main Mini App** (BotFather → Main Mini App): enlace `https://t.me/tasalobot?startapp[=valor]`; abre a pantalla completa por defecto (`mode=compact` para media altura). El valor llega en `Telegram.WebApp.initDataUnsafe.start_param` y en el GET `tgWebAppStartParam` → sirve para enlaces profundos (`alerts`, `tspl`, `calc`) y para cargar la pantalla correcta sin parpadeo. **Requiere BotFather (a aprobar).**
  - **Enlace directo** `https://t.me/tasalobot/<appname>?startapp=…` (necesita registrar la app en BotFather).
- **Botón de teclado `web_app` (`sendData`) no se usa**: cierra la miniapp y solo envía hasta 4096 bytes al bot. No sirve para TASALO.
- Los Mini Apps abiertos desde enlace directo/main **no** pueden leer ni enviar mensajes en el chat; para compartir hay que usar `switchInlineQuery`/`shareMessage`.

## 2. Validar `initData` (obligatorio en el servidor)

`Telegram.WebApp.initData` es una query string (campos `auth_date`, `query_id`, `user` (JSON), `hash`, `signature`, …). Algoritmo oficial (primera parte):

1. Parsear la cadena y **separar `hash`**. Los demás campos, ordenados alfabéticamente, se unen como `clave=valor` con salto de línea `\n` → `data_check_string` (valores ya decodificados, sin re-codificar el JSON de `user`).
2. `secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)` — la doc lo describe como «la firma HMAC-SHA-256 del token del bot con la constante `WebAppData` como clave».
3. `calculado = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))`; comparar con `hash` usando `hmac.compare_digest`.
4. Rechazar si `auth_date` es demasiado viejo (la doc lo recomienda; el plan usa 24 h por defecto, configurable en `INITDATA_MAX_AGE`).
5. Solo después de validar se usa `user.id`; `initDataUnsafe` **nunca** es de fiar.

Notas de implementación (a cubrir con tests en S0):
- **`signature`**: la doc de uso por terceros excluye `hash` **y** `signature` del `data_check_string`; la del bot solo nombra `hash`. Al implementarlo, probar con un `initData` real que incluya `signature` y dejarlo dentro del cálculo HMAC (solo se quita `hash`); si la prueba real falla, ajustar. **[?] verificar con un `initData` real en S0.**
- `user.id` tiene hasta 52 bits significativos: en JS es seguro como `Number`; en Python, `int`.
- Validación por terceros (Ed25519 con `bot_id`, claves públicas oficiales de test y producción) **no hace falta**: la miniapp es first-party y tiene el token del bot en su `.env`.
- `can_send_after`, `chat`, `chat_type`, `chat_instance` no se usan.

## 3. Funciones aprovechables (con degradación)

| Función | Mín. | Uso en TASALO | Si no existe |
|---|---|---|---|
| `ready()`, `expand()` | 6.0 | una sola llamada de `ready()` al cargar la UI esencial | — |
| `colorScheme`, `themeParams`, evento `themeChanged` | 6.0 | modo oscuro/claro; Quiet Glass manda sobre `themeParams` (solo se leen para detectar el esquema) | usar `prefers-color-scheme` |
| `BackButton` (`show/hide/onClick`) | 6.1 | cerrar overlays (detalle histórico, post del blog, formularios de alertas) | botón «Atrás» propio en cabecera |
| `HapticFeedback` (`impact`, `notification`, `selectionChanged`) | 6.1 | éxito/error al guardar, cambio de pestaña | sin vibración |
| `setHeaderColor`, `setBackgroundColor` | 6.1 (colores libres desde 6.9) | sincronizar con tokens `--bg` | no llamar (hoy `base.html` ya protege con `typeof`) |
| `setBottomBarColor` | 7.10 | barra inferior/navegación Android | no llamar |
| `showPopup`, `showAlert`, `showConfirm` | 6.2 | confirmar borrados y avisos; `showPopup`: máx. 3 botones, mensaje 1–256 caracteres | `window.confirm`/modal propio |
| `enableClosingConfirmation` | 6.2 | formularios de alertas con cambios sin guardar | sin confirmación |
| `MainButton` / `SecondaryButton` (`showProgress`) | 6.0 / 7.10 | Guardar / Cancelar alerta | botones propios en el formulario |
| `SettingsButton` | 7.0 | abrir Ajustes desde el menú contextual | engranaje propio en cabecera |
| `openLink(url)`, `openTelegramLink(url)` | 6.1 | Ecency, enlaces externos; solo en respuesta a un toque | `window.open` |
| `switchInlineQuery(q[, tipos])` | 6.7 | compartir resultado de la calculadora | `openTelegramLink('https://t.me/share/url?…')` |
| `requestWriteAccess` + `allows_write_to_pm` | 6.9 | que el bot pueda escribir al usuario (alertas, `/tspl`) | mostrar «Inicia el bot (/start)» |
| `CloudStorage` | 6.9 | ajustes sincronizados: hasta 1024 claves por usuario, clave 1–128 caracteres `A-Za-z0-9_-`, valor 0–4096 caracteres; con callbacks (no promesas) | `localStorage` |
| `disableVerticalSwipes` / `enableVerticalSwipes` | 7.7 | solo en gráficos si el gesto choca | dejar el swipe por defecto |
| `safeAreaInset`, `contentSafeAreaInset`, eventos `safeAreaChanged`/`contentSafeAreaChanged`; CSS `--tg-safe-area-inset-*`, `--tg-content-safe-area-inset-*` | 8.0 | márgenes de la barra flotante y cabecera | `env(safe-area-inset-*)` (ya en `base.html`) |
| `isActive`, eventos `activated`/`deactivated` | 8.0 | refrescar tasas al volver a la miniapp | refrescar con `visibilitychange` |
| `requestFullscreen` / `exitFullscreen` | 8.0 | opcional, no por defecto | no llamar |
| `addToHomeScreen`, `checkHomeScreenStatus` | 8.0 | acceso directo en Ajustes (estados `unsupported`/`unknown`/`added`/`missed`) | ocultar la opción si `unsupported` |
| `downloadFile({url, file_name})` | 8.0 | descargar recibo de la calculadora; el servidor debe enviar `Content-Disposition: attachment; filename="…"` y `Access-Control-Allow-Origin: https://web.telegram.org` | generar el recibo como texto para copiar |
| `shareMessage(msg_id)` | 8.0 | **no** se usará: exige `savePreparedInlineMessage` desde el bot (cambio en `taso-bot`) | `switchInlineQuery` |
| `DeviceStorage` | 9.0 | caché local (hasta 5 MB por usuario), sustituto de `localStorage` para caché | `localStorage` |
| `SecureStorage` | 9.0 | no hace falta | — |
| `platform`, `version` | 6.1 / 6.0 | registro de diagnóstico sin datos personales | — |

Nota: las funciones sin etiqueta de versión en la doc (p. ej. `ready`, `expand`, `themeParams`, `MainButton`) existen desde Bot API 6.0; la miniapp debe protegerse con `isVersionAtLeast` solo en las de la tabla con versión ≥ 6.1.

## 4. Eventos que usará la miniapp
`themeChanged`, `viewportChanged` (con `isStateStable`), `safeAreaChanged`, `contentSafeAreaChanged`, `activated`/`deactivated`, `backButtonClicked`, `settingsButtonClicked`, `mainButtonClicked`, `secondaryButtonClicked`, `popupClosed`, `writeAccessRequested` (`allowed`/`cancelled`), `homeScreenAdded`/`homeScreenChecked`, `fileDownloadRequested` (`downloading`/`cancelled`).

## 5. Rendimiento en Android (User-Agent)
En Android el User-Agent termina en `Telegram-Android/{versión} ({fabricante} {modelo}; Android {x}; SDK {n}; {clase})` con `{clase}` = `LOW`, `AVERAGE` o `HIGH`. Regla del plan: si la clase es **`LOW`**, quitar blur/animaciones costosas y usar el fondo del sparkline con gradiente SVG; respetar también `prefers-reduced-motion`. Solo se lee la clase; no se guarda el User-Agent.

## 6. Guías de diseño de Telegram que se respetan
Mobile-first y responsive; animaciones fluidas (≈60 fps); entradas e imágenes con etiquetas accesibles; seguir los colores del tema dinámico (aquí: Quiet Glass, sincronizado con `setHeaderColor`/`setBackgroundColor`/`setBottomBarColor`); respetar `safeAreaInset` y `contentSafeAreaInset`; atenuar efectos en dispositivos de gama baja.

## 7. Pruebas y depuración (para quien despliegue)
- Entorno de prueba de Telegram (servidor aparte; permite HTTP sin TLS): `https://api.telegram.org/bot<token>/test/METHOD_NAME`.
- Depuración de WebView: Android (pulsar dos veces la versión en Ajustes → «Enable WebView Debug» → `chrome://inspect/#devices`); iOS («Allow Web View Inspection» + Safari Develop); Telegram Desktop Windows/Linux beta («Enable webview inspection»); macOS beta («Debug Mini Apps»).
- Registro de diagnóstico del cliente: `Telegram.WebApp.version` y `platform` (sin datos personales).

## 8. Telegram Serverless (novedad, 6 oct 2026): evaluación
Qué es: backend en JavaScript (módulos en `tgcloud/`, aislado en V8), base de datos SQLite integrada, HTTP saliente, hosting del front en `https://app<app_id>.tgcloud.ai/`, `Telegram.WebApp.Serverless.call(nombre, entrada, callback)` que envía `initData` y la plataforma **valida el `initData` antes de ejecutar el endpoint** (error `UNAUTHORIZED` si falta o es inválido).

**Decisión recomendada: no usarlo en esta reescritura.** Razones:
1. Los datos de TASALO (usuarios, alertas, suscripciones, historial) viven en `taso-api` (FastAPI + PostgreSQL) y el bot los usa por ahí; Serverless traería una **segunda base** (SQLite) y duplicaría contratos.
2. El stack es Python/Flask/FastAPI; Serverless exige reescribir el servidor en JavaScript y desplegar con `tgcloud`, mientras Ernesto despliega con `git pull` + `systemctl` en su VPS.
3. El front quedaría en el dominio `tgcloud.ai`, no en `tasalo.duckdns.org/miniapp`, y se perdería el control del CSP y de las cabeceras (`downloadFile` exige cabeceras CORS concretas).
4. Se acaba de publicar (hace 3 días): sin historial de estabilidad; no hay información en la doc sobre límites de uso ni coste que permita decidir.
Lo que sí se aprovecha como idea: que **la validación de `initData` ocurra en el servidor antes de cualquier lógica** (el BFF de `taso-app` hace lo mismo). Revisar de nuevo si algún día se quiere dejar de operar el VPS.

## 9. Impacto para el plan (F3)
- La validación de `initData` es una función pura en `taso-app` (Python) con tests: válido, manipulado, expirado, sin `hash`, `user` mal formado, y con `signature` presente.
- Enlaces profundos por `start_param` (`alerts`, `tspl`, `calc`) → requieren Main Mini App o botones `web_app` con `?tab=` en el bot (cambios en `taso-bot`/BotFather, a aprobar en G1).
- `allows_write_to_pm` y `requestWriteAccess` son necesarios para que las alertas y `/tspl` puedan llegar al usuario.
- `CloudStorage` es suficiente para los ajustes (pocas claves < 4096 caracteres); migración desde `localStorage` en el primer arranque sin perder valores.
- El SDK de Telegram es el único script de terceros permitido (`https://telegram.org`); Tailwind, Chart.js y Google Fonts salen del producto.
