# Plan — Perfil, Ajustes y Estadísticas de admin (taso-app)

Fecha: 2026-10-12 · Pedido y **aprobado por Ernesto en el chat** («implementa, actualiza github»). Sustituye a las filas **S6 (pestaña Alertas)**, **S7** y **S8** de `PLAN_REESCRITURA.md`. No toca `taso-bot` ni `taso-api` (solo lee sus endpoints admin ya existentes).

## 1. Qué cambia
1. La pestaña **Alertas** pasa a ser **Perfil** (`#/perfil`). Arriba: tarjeta con los datos del usuario que entra (nombre, @usuario, id, foto, idioma, si es admin). Debajo: «Mis avisos», que es lo que hoy hay en Alertas (4 tipos, mismos paneles). Alertas de precio propias (F4) vivirán aquí.
2. Arriba a la derecha de Perfil: icono de **ajustes** → `#/ajustes` (ventana propia con botón Atrás de Telegram).
3. **Ajustes** (modelo: app Android `SettingsScreen.kt`, adaptado): Apariencia (tema auto/claro/oscuro, invertir colores sube/baja, vista Tasas tarjetas/lista), Tasas (fuente por defecto, monedas visibles), Instalación (añadir a pantalla de inicio, si el cliente lo soporta), Acerca de (versión, desarrollador, enlaces). Sin lo que no aplica a la web (URL de la API, informe de fallos, actualizaciones del APK).
4. **Admin** (solo si `user.id ∈ ADMIN_CHAT_IDS`): debajo del perfil, panel «Estado del sistema» con lo del `/status` del bot, mejor adaptado a la web, y las estadísticas **del bot y de la app**, con indicadores y gráficos pequeños en SVG propio (sin Chart.js).
5. Se retiran la vieja `/stats` con login por clave (S8) y la clave admin en el navegador.

## 2. Compatibilidad
- `#/alertas` y `?startapp=tab_alertas` siguen funcionando (alias → `#/perfil`). «Recibir cada día» del Blog apunta a `#/perfil?nueva=tspl`.
- Los ajustes se guardan en `CloudStorage` (si el cliente ≥ 6.9) con respaldo `localStorage`; migración desde `tasalo:source` y `tasalo_settings`.

## 3. Datos (servidor)
- `GET /api/me` se amplía: `username`, `last_name`, `photo_url` (https), `is_premium`, además de lo actual. Todo sale del `initData` validado.
- `GET /api/admin/overview?window=24h|7d|30d` (`@require_admin`; 403 a no admin; la clave nunca sale en la respuesta). Reúne con caché de 30 s y stale-if-error: `taso-api` `/admin/status` (scheduler y jobs), `/admin/stats/summary` (usuarios, comandos 24h/7d/30d, top usuarios, rendimiento), `/admin/stats/api-usage?window=` (por cliente y endpoint) y `/health` (versión/commit); más datos propios de la app: monedas más consultadas y consultas por día (SQLite `coin_queries`), usuarios únicos que usaron Mercado, y alertas de precio activas cuando exista F4.
- Cada bloque llega con su propio `ok` (si falla uno, los demás se ven).

## 4. Diseño (Quiet Glass v3, tokens de `docs/DISENO.md`)
- Perfil: avatar circular con inicial si no hay foto; nombre grande, @usuario en `--text2`, chips (id, idioma, Admin). Engranaje como `.icon-btn` en `view-actions`.
- Mis avisos: las mismas tarjetas con pastilla de estado.
- Admin: tarjeta de salud (punto verde/amarillo/rojo + texto, no solo color), 4 indicadores (usuarios, activos 24 h, nuevos 7 d, errores), barras horizontales de comandos (selector 24h/7d/30d), barra apilada de uso de la API por cliente, lista de jobs con estado, top endpoints, y bloque «App web» (monedas más vistas, uso de Mercado). Todo con texto equivalente para lectores de pantalla.
- **Figma:** no hay conector de Figma disponible en este entorno; la inspiración sale de la app Android, del `/status` del bot y de las maquetas Design ya aprobadas. Maquetas nuevas en el mismo lienzo Design (ver Handoff §4).

## 5. Rebanadas (cada una deja el repo coherente y con commit propio)
- **P1 Servidor:** `/me` ampliado, `/api/admin/overview`, tests (403, sin fugas de clave, caché, un bloque caído).
- **P2 Perfil:** pestaña Perfil + alias + tarjeta de usuario + «Mis avisos» + engranaje.
- **P3 Ajustes:** `modules/settings.js` (CloudStorage + migración) y `views/ajustes.js`; Tasas lee tema/vista/convención/fuente/monedas.
- **P4 Admin web:** `views/perfil-admin.js` + `modules/admin.js` (formato puro) + gráficos SVG; retirada de `/stats`.
- **P5 Mensajes del equipo** (campana de S7): después, como sección «Novedades» en Ajustes.
- Luego **F4** (alertas de precio propias): su UI va en Perfil → «Mis avisos».

## 6. Pruebas
`node --test` (formato admin, ajustes, migración, alias de rutas); pytest (autorización, caché, degradación); humo jsdom `_shots/smoke8.mjs` (Perfil usuario, Perfil admin, Ajustes). Sin prueba visual en Telegram hasta que Ernesto la haga.

## Ampliación 2026-10-12: «Mis estadísticas» para cada usuario (P4b)
Pedido de Ernesto: cada usuario ve sus propias estadísticas de uso (comandos y demás), como el `/status` del bot pero personal. Requiere un endpoint nuevo de solo lectura en `taso-api` (`GET /api/v1/admin/stats/users/{user_id}`, agrega `bot_command_stats`; sin migración). **No aprobado todavía (G3)**: hasta entonces no se toca `taso-api`. En la miniapp: `GET /api/me/stats` (el `user_id` sale solo del `initData`), tarjeta en Perfil → `#/estadisticas`, barras reutilizando `modules/admin.js`. Parte local sin aprobación: consultas propias de Mercado y alertas de precio (SQLite de la miniapp).
