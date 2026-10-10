# Sistema de diseño — miniapp TASALO (F4)

Fuente de verdad: **Quiet Glass v3** de `taso-android` (`ui/theme/Theme.kt`). La skill `ui-ux-pro-max` valida y completa; no reemplaza la marca.
Salida de la skill (persistida): `design-system/tasalo-miniapp/MASTER.md` (**no usar su paleta/tipografía**, ver §5).

## 1. Tokens CSS (oscuro = por defecto; claro con `[data-theme="light"]`, sigue `Telegram.WebApp.colorScheme`)

| Token | Oscuro | Claro | Origen en `Theme.kt` |
|---|---|---|---|
| `--bg` | `#0E1621` | `#E6EEF1` | background |
| `--surface` | `#121C28` | `#DDE7EB` | surface |
| `--card` | `#16212F` | `#EEF4F6` | surfaceVariant (oscuro) / surfaceContainerHigh (claro, ver nota) |
| `--card-high` | `#1C2937` | `#F4F8FA` | surfaceContainerHigh / surfaceContainerHighest |
| `--accent` | `#3DD6C0` | `#09665B` | primary |
| `--on-accent` | `#06201C` | `#FFFFFF` | onPrimary |
| `--accent-soft` | `rgba(61,214,192,.14)` | `rgba(9,102,91,.10)` | GlassTokens.accentSoft |
| `--border` | `rgba(255,255,255,.08)` | `rgba(30,48,64,.09)` | GlassTokens.border |
| `--border-accent` | `rgba(61,214,192,.35)` | `rgba(9,102,91,.28)` | GlassTokens.borderAccent |
| `--text` | `#E8EEF5` | `#1B2A33` | onBackground |
| `--text2` | `#9FB0C3` | `#4F6470` | onSurfaceVariant |
| `--outline` | `#5F7389` | `#6E818C` | outline (solo UI ≥ 3:1) |
| `--up` / `--down` (defecto: sube rojo, baja verde; invertible con `[data-invert]`) | `#F2555F` / `#34D399` | `#BC2C3C` / `#13724F` | changeColorsFor |
| `--neutral` | `#8FA0B3` | `#566873` | changeColorsFor |
| `--error` | `#F2555F` | `#BC2C3C` | error |
| `--error-bg` | `#3A1A20` | `#F8D9DD` | errorContainer |

Nota claro: en Android la tarjeta clara es una superficie translúcida; con `#D6E1E6` (surfaceVariant) `--up`, `--down` y `--neutral` quedan a 4,43 / 4,45 / 4,35:1 (< 4,5). Se usa `#EEF4F6` para `--card` (5,31 / 5,33 / 5,22:1).

Halo de fondo: un `radial-gradient` turquesa (`--accent-soft`) arriba a la izquierda, como `quietGlassBackground()`.
Sincronizar con Telegram: `setHeaderColor(--bg)`, `setBackgroundColor(--bg)`, `setBottomBarColor(--surface)`.

## 2. Contraste verificado (WCAG; script de sandbox, se portará a `tests/` en S0)
Oscuro: texto/fondo 15,6 · text2/card 7,3 · accent/bg 10,0 · up/card 4,83 · down/card 8,45 · neutral/card 6,07 · on-accent/accent 9,4 · outline/card 3,33.
Claro (con card `#EEF4F6`): texto 13,3 · text2 5,6 · accent 6,2 · up 5,3 · down 5,3 · neutral 5,2 · on-accent/accent 6,86 · outline/bg 3,45 · outline/card 3,65.
Regla del test: texto ≥ 4,5:1; componentes de UI/bordes de control ≥ 3:1; en ambos temas y para la convención invertida.

## 3. Tipografía, forma y movimiento
- **Space Grotesk** (títulos y texto) + **JetBrains Mono** (cifras, tasas, horas), autoalojadas en `static/fonts/` (woff2, `font-display: swap`; licencias OFL en `taso-android/docs/licencias-fuentes/`). Cifras con `font-variant-numeric: tabular-nums`.
- Escala relativa (rem), sin alturas fijas en texto; objetivo táctil mínimo 44 px; probar al 200 % de escala de fuente.
- Esquinas 20 px (tarjetas), 12 px (campos, chips internos); píldora solo en la barra flotante y los chips.
- Iconos: SVG de trazo 2, extremos redondeados, cuadrícula 24 (como `NavIcons.kt`); sin emojis como iconos.
- Movimiento: 150–250 ms; `prefers-reduced-motion` desactiva animaciones; en Android `LOW` (User-Agent) sin blur: sparkline con SVG/gradiente, no `filter: blur`.
- Foco visible en todo elemento interactivo (`outline` 2 px `--accent`); estados: cargando (esqueleto), vacío, error, sin conexión, no identificado, datos desactualizados.

## 4. Estructura de pantallas (a validar en maquetas, G2)
Cabecera que se recoge (título, «actualizado hace X», campana de mensajes, engranaje de Ajustes) · contenido · **barra flotante tipo cápsula** con 5 pestañas: Tasas · Combustible · Calculadora · Blog · Alertas. Overlays con `BackButton`: Detalle histórico, Post del Blog, formularios de alerta, Ajustes, Mensajes. Respetar `--tg-safe-area-inset-*` y `--tg-content-safe-area-inset-*`.
Tableros de maqueta: los del Anexo B del prompt (16), todos en oscuro y claro, a 390 px.

## 5. Recomendaciones de la skill descartadas
| Recomendación | Decisión | Motivo |
|---|---|---|
| Patrón «Hero + Features + CTA» | Descartado | Es de landing de marketing; la miniapp es una herramienta con pestañas |
| Estilo «Minimalism & Swiss», fondo `#F8FAFC` | Descartado | La marca es Quiet Glass v3 (azul noche + cristal); además se evitan fondos off-white |
| Paleta azul `#2563EB` + CTA naranja `#EA580C` | Descartada | Un solo acento turquesa (`#3DD6C0`); el azul/índigo es la paleta antigua |
| Tipografía Outfit / Work Sans y Google Fonts | Descartada | Space Grotesk + JetBrains Mono autoalojadas; sin Google Fonts en producción |
| Heroicons/Lucide como paquete | Descartado | Iconos SVG propios al estilo `NavIcons.kt` (sin dependencia) |
| **Aceptado:** contraste 4,5:1, foco visible, `cursor: pointer`, `prefers-reduced-motion`, sin emojis como iconos, estados hover 150–300 ms, comprobar 375/390 px | — | Coinciden con las reglas del prompt |
