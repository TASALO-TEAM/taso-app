# Análisis: llevar `/p`, `/ta` y `/graf` a la miniapp (pedido de Ernesto tras G2)

Fecha: 2026-10-09 · Estado: **análisis para aprobar; nada implementado** · Actualiza **D8** de `PLAN_REESCRITURA.md`.
Lo leído (código real de `taso-bot`): `src/handlers/p.py` completo, `src/handlers/ta.py` completo, `src/handlers/trading.py` (`/graf`, `/mk`), cabeceras y firmas de `src/crypto_client.py` y `src/core/ai_logic.py`. **No leído aún** (hay que revisarlo antes de implementar, marcado `[?]`): `build_crypto_message` en `formatters.py`, el cuerpo de `get_crypto_data` y `get_groq_price_spotlight`, `utils/subscription_manager.py` (`check_feature_access`) y si `taso-api` ya expone algo de cripto aparte de `latest.binance`.

## 1. Cómo funciona hoy en el bot

| Comando | Datos | IA | Botones |
|---|---|---|---|
| `/p <MONEDA>` | `CryptoApiClient.get_crypto_data(symbol)`: CoinMarketCap (pool de claves con rotación) → CryptoCompare/CoinGecko de respaldo; máx./mín. 24 h vía Binance o CryptoCompare. Mensaje con precio, high/low, cambios %, precio en ETH/BTC y bloque extendido (ATH/ATL, supply, categoría) | **Panorama IA**: `get_groq_price_spotlight(datos)` (Groq, modelo `openai/gpt-oss-120b`, pool de claves con rotación) | Actualizar · Análisis técnico 4H · Panorama IA · Crear alerta |
| `/ta <MONEDA> [PAR] [TIEMPO]` | Velas de Binance (y binance.us); indicadores con `pandas_ta` (RSI, MFI, CCI, ADX, Williams %R, OBV, MACD, EMA), `BTCAdvancedAnalyzer`, pivotes; si Binance falla, `tradingview_ta` | **Análisis IA Profesional**: `get_groq_crypto_analysis`, que recibe el **texto Markdown** del reporte ya armado | Ver en TradingView/Local · Ver gráfico · Análisis IA · Crear alerta |
| `/graf <MONEDA> [PAR] <TIEMPO>` | Velas de Binance → KuCoin → Bybit; señal de TradingView; **imagen PNG generada en el servidor** (`generate_ohlcv_chart`: EMA20/50/200, RSI, volumen, Bollinger) | No | Temporalidades 4h/12h/1d/1w · TradingView · /ta · Crear alerta |

Dependencias pesadas del bot: `pandas`, `pandas_ta`, `tradingview_ta` (por eso el `pytest` local de Windows no corre completo), claves de CMC y Groq con rotación, y `check_feature_access` / `registrar_uso_comando` (límites por usuario o por plan `[?]`).

## 2. Dónde vive la lógica: decisión que necesito de ti (D8-a)

La miniapp no puede reutilizar nada de esto tal cual: el bot es de polling (sin HTTP) y `taso-api` no tiene endpoints de cripto (solo `latest.binance`, 20 monedas, ≤ 15 min `[?]`). Tres caminos:

| Opción | Qué es | Pros | Contras |
|---|---|---|---|
| **A. Router de cripto en `taso-api`** (`/api/v1/crypto/…`) | Portar `crypto_client` + prompts de Groq a la API; el BFF solo consume | Un solo sitio; el bot podría migrar después; claves solo en la API | Es el cambio más grande; toca `taso-api` y luego el bot; despliegue conjunto |
| **B. BFF en `taso-app` con fuentes públicas** (recomendada para v1) | Endpoint propio `GET /miniapp/api/crypto/<SYM>` que consulta Binance `ticker/24hr` (sin clave) y CoinGecko público (ATH/ATL, supply, categoría) con caché de 60 s; Groq desde el servidor con límite por usuario | No toca la API ni el bot; sin dependencias pesadas; rápido de construir y probar | Duplica un poco de lógica; **la clave de Groq pasa a vivir también en el `.env` de `taso-app`**; los números pueden diferir levemente de `/p` (que usa CMC) |
| **C. Endpoint HTTP dentro del bot** | Exponer `get_crypto_data` desde el proceso del bot | Reutiliza todo | El bot no tiene servidor; añade superficie de ataque; se descarta |

**Recomendación: B para `/p` ahora**, dejando la puerta abierta a A si más adelante quieres consolidar. Riesgos de B: coste/cupo de Groq (mitigado con caché por moneda ≈ 10 min y límite por usuario, mismo criterio que el bot `[?]`) y rate limit de CoinGecko (caché + «sirve lo último si falla»).

## 3. Propuesta funcional

**Pantalla «Mercado» (`/p`)**, no es una 6.ª pestaña: se abre desde un icono de búsqueda en la cabecera de Tasas (overlay con `BackButton`; llegada directa con `?startapp=p_BTC`).
- Campo para escribir la moneda (símbolo; sugerencias con las 20 de `latest.binance` y las últimas búsquedas guardadas en `CloudStorage`). Al buscar, **los datos salen debajo**: precio, cambio 24 h, máx./mín., precio en BTC/ETH y bloque extendido (ATH/ATL, supply, categoría) con «actualizado hace X».
- Opciones debajo del resultado, como el teclado del bot: **Actualizar** · **Panorama IA** (se genera bajo demanda, con aviso «experimental», caché y límite por usuario) · **Crear alerta** (abre «Alerta de precio» con la moneda y el precio actual ya rellenados) · *(fase 2)* Análisis técnico y Gráfico.
- Estados: cargando, moneda no encontrada, fuentes caídas (muestra lo último con aviso), IA no disponible.

**`/graf` (fase 2, complejidad media):** no hace falta la imagen PNG; el BFF hace de proxy de velas de Binance (caché corta, `connect-src 'self'`) y el cliente dibuja velas y EMA en **SVG propio** (mismo enfoque que D5), con selector 4h/12h/1d/1w. Matemática en JS puro con `node --test`.

**`/ta` (fase 2–3, complejidad alta):** requiere indicadores. Dos caminos: (i) calcularlos en JS (RSI, MACD, EMA, pivotes) sobre las mismas velas, con tests; (ii) meter `pandas_ta` en el servidor de la miniapp (pesado, no recomendado). Recomiendo (i) con un conjunto reducido (RSI, MACD, EMA 20/50/200, pivotes, señal compra/venta) y el botón «Análisis IA» que manda ese resumen a Groq. Diferirlo hasta que `/p` y `/graf` estén estables.

## 4. Cambios al plan
- **D8 pasa de «evaluar y no construir» a «construir `/p` (fase 1); `/graf` y `/ta` en fases posteriores»**, previa tu aprobación.
- Secciones nuevas (después de S8, antes de S9): **S10 Mercado `/p`** · **S11 Gráfico `/graf`** (opcional) · **S12 Análisis `/ta` + IA** (opcional).
- Variables nuevas en `.env.example`: `GROQ_API_KEY` (pool separado por comas, como el bot), `CRYPTO_CACHE_TTL`, `AI_RATE_LIMIT_PER_USER`; opcional `COINGECKO_API_KEY`.
- Pruebas: normalización de símbolos y rechazo de entradas raras, caché y «sirve lo último», límite de IA por usuario, sanitizado del texto de la IA (sin HTML crudo), respuesta cuando Groq/CoinGecko fallan; JS: mapeo de campos y, en fases 2–3, indicadores y velas.
- Playwright: se usará desde S0 para comprobar la UI real (pantallas, estados, 200 % de fuente, claro/oscuro).

## 5. Preguntas para ti
1. **D8-a:** ¿opción B (BFF con fuentes públicas) para `/p`, o prefieres A (router en `taso-api`)?
2. ¿Las funciones de IA del bot tienen límites o planes (`check_feature_access`)? Si sí, ¿la miniapp debe respetarlos igual? Lo reviso en el código antes de implementar.
3. ¿Entra solo `/p` en esta reescritura y `/graf` y `/ta` quedan para una versión posterior? (mi recomendación)
