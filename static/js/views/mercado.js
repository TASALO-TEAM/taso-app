// Pantalla Mercado (el /p del bot): búsqueda por símbolo, top 5 de monedas más consultadas y tarjeta con los datos.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). El formato y las reglas puras viven en modules/market.js.
import { ApiError, getMarket, getMarketChart, getMarketNews, getMarketTop, postPanorama } from "../modules/api.js";
import { priceChart, seriesSparkline } from "../modules/charts.js";
import { h, icon, ICONS } from "../modules/dom.js";
import * as fmt from "../modules/format.js";
import {
  DEFAULT_RANGE,
  PANORAMA_DISCLAIMER,
  RANGES,
  changes,
  cleanSeries,
  cleanTop,
  detailRows,
  extraRows,
  marketBanner,
  normalizeRange,
  normalizeSymbol,
  panoramaError,
  panoramaParagraphs,
  pct,
  rangeChange,
  readoutText,
  sourceNote,
  usd,
} from "../modules/market.js";
import { load, save } from "../modules/storage.js";
import { newsCarousel } from "../modules/news-carousel.js";
import { cleanNews } from "../modules/news.js";

const LAST_KEY = "tasalo:market:last";
const CACHE_KEY = "tasalo:market:cache";
const RANGE_KEY = "tasalo:market:range";
const CHART_TTL_MS = 2 * 60 * 1000; // el servidor ya cachea la serie unos minutos; no se pide más a menudo
const NEWS_TTL_MS = 10 * 60 * 1000; // el servidor cachea cada fuente 10 min: no se pide antes
const SPARK_RANGE = "1d"; // la tira de monedas siempre muestra las últimas 24 h
const READ_HINT = "Toca o desliza sobre la gráfica para ver el precio.";
const DEFAULT_SYMBOL = "BTC";
const REFRESH_MS = 60 * 1000; // CoinMarketCap refresca cada minuto; el servidor ya cachea 60 s
const TICK_MS = 30 * 1000;
const ARROW = { up: "▲", down: "▼", neutral: "■" };
const WORD = { up: "subió", down: "bajó", neutral: "sin cambios" };

function validCache(cache) {
  return Boolean(cache && typeof cache === "object" && typeof cache.symbol === "string" && cache.data && typeof cache.data === "object");
}

/**
 * Monta la pantalla. ctx = { view, actions, setSubtitle }.
 * Devuelve la función que la desmonta (quita temporizadores y escuchas).
 */
export function mount(ctx) {
  const cache = load(CACHE_KEY, null);
  const lastSaved = normalizeSymbol(load(LAST_KEY, DEFAULT_SYMBOL)) || DEFAULT_SYMBOL;
  const state = {
    symbol: lastSaved,
    top: cleanTop(null),
    data: null,
    dataFor: null,
    stale: false,
    status: "loading", // loading | ready | notfound | error
    offline: false,
    inputError: "",
    now: Date.now(),
    pan: new Map(), // símbolo -> {status: loading|ready|error, ...}; sobrevive a los refrescos y al cambio de moneda
    range: normalizeRange(load(RANGE_KEY, DEFAULT_RANGE)),
    charts: new Map(), // "SIMBOLO|rango" -> {status: loading|ready|none|error, series, at}; la tira usa siempre 1d
    news: { status: "loading", items: [], at: 0 }, // titulares generales (S10 F5): loading | ready | error; `at` = ultima respuesta
  };
  let alive = true;
  let fetchToken = 0;
  let lastFetch = 0;
  let tickerFocus = null;

  // ---------- Esqueleto fijo (los huecos se rellenan al renderizar; el campo de texto no se recrea) ----------
  const bannerSlot = h("div", { class: "slot" });
  const input = h("input", {
    class: "mk-input",
    id: "mk-symbol",
    type: "text",
    inputmode: "text",
    autocapitalize: "characters",
    autocomplete: "off",
    autocorrect: "off",
    spellcheck: "false",
    maxlength: "16",
    placeholder: "Símbolo, por ejemplo BTC",
    "aria-label": "Símbolo de la moneda",
    "aria-describedby": "mk-input-error",
  });
  input.value = state.symbol;
  const errorSlot = h("p", { class: "mk-err", id: "mk-input-error", role: "alert" });
  errorSlot.hidden = true;
  const submitBtn = h("button", { type: "submit", class: "btn mk-go", "aria-label": "Buscar moneda" }, icon(...ICONS.search));
  const form = h(
    "form",
    {
      class: "mk-search",
      role: "search",
      onSubmit: (e) => {
        e.preventDefault();
        const symbol = normalizeSymbol(input.value);
        if (!symbol) {
          state.inputError = "Escribe el símbolo de una moneda, por ejemplo BTC.";
          renderInputError();
          input.focus();
          return;
        }
        state.inputError = "";
        renderInputError();
        input.value = symbol;
        input.blur();
        select(symbol, true);
      },
    },
    input,
    submitBtn,
  );
  // Tira horizontal de monedas (desplazable con snap) y piezas de la gráfica: se crean una vez y la tarjeta las recoloca.
  const tickerSlot = h("div", { class: "mk-ticker", role: "group", "aria-label": "Monedas más consultadas" });
  const rangeBar = h(
    "div",
    { class: "seg mk-ranges", role: "group", "aria-label": "Rango de la gráfica" },
    RANGES.map((r) => h("button", { type: "button", class: "seg-btn", text: r.label, dataset: { range: r.id }, onClick: () => setRange(r.id) })),
  );
  const rangeChg = h("div", { class: "mk-rchg" });
  const chartBox = h("div", { class: "mk-chart" });
  const content = h("div", { class: "slot" });
  const newsSlot = h("div", { class: "mk-stack" }); // fuera de `content`: repintar la moneda no reinicia el carrusel
  ctx.view.replaceChildren(bannerSlot, form, errorSlot, tickerSlot, content, newsSlot);
  ctx.actions.replaceChildren();

  // ---------- Datos ----------
  function select(symbol, force = false) {
    if (!force && symbol === state.symbol && state.status === "ready" && state.dataFor === symbol) return;
    state.symbol = symbol;
    input.value = symbol;
    save(LAST_KEY, symbol);
    fetchCoin(symbol);
    loadCharts(symbol);
  }

  // ---------- Gráficas (S10 F4) ----------
  const chartKey = (symbol, range) => `${symbol}|${range}`;
  const chartOf = (symbol, range) => state.charts.get(chartKey(symbol, range)) || null;

  async function loadChart(symbol, range, { force = false } = {}) {
    const key = chartKey(symbol, range);
    const cur = state.charts.get(key);
    if (cur && cur.status === "loading") return;
    if (!force && cur && cur.status !== "error" && Date.now() - cur.at < CHART_TTL_MS) return;
    state.charts.set(key, { status: "loading", series: cur ? cur.series : [], at: cur ? cur.at : 0 });
    renderChartsFor(symbol, range);
    let next;
    try {
      const res = await getMarketChart(symbol, range);
      const series = cleanSeries(res && res.points);
      next = { status: series.length >= 2 ? "ready" : "none", series, at: Date.now() };
    } catch (e) {
      const gone = e instanceof ApiError && (e.status === 404 || e.status === 400);
      next = { status: gone ? "none" : "error", series: cur ? cur.series : [], at: Date.now() };
    }
    if (!alive) return;
    state.charts.set(key, next);
    renderChartsFor(symbol, range);
  }

  // La gráfica grande y la tira se repintan solo cuando cambia lo que muestran (el cursor táctil no se reinicia por otra moneda).
  function renderChartsFor(symbol, range) {
    if (symbol === state.symbol && range === state.range) renderChart();
    if (range === SPARK_RANGE) renderTicker();
  }

  function loadCharts(symbol) {
    loadChart(symbol, state.range);
    if (state.range !== SPARK_RANGE) loadChart(symbol, SPARK_RANGE);
  }

  function setRange(id) {
    const range = normalizeRange(id);
    if (range === state.range) return;
    state.range = range;
    save(RANGE_KEY, range);
    renderRanges();
    renderChart();
    loadChart(state.symbol, range);
  }

  // ---------- Noticias (S10 F5): generales, no dependen de la moneda ----------
  // La tarjeta se crea una vez y solo se rehace si cambian los titulares: repintar no devuelve el carrusel a la primera noticia.
  let newsCard = null;
  let newsSig = "";
  let newsBusy = false;

  async function loadNews() {
    if (newsBusy) return;
    newsBusy = true;
    try {
      const res = await getMarketNews();
      state.news = { status: "ready", items: cleanNews(res && res.items), at: Date.now() };
    } catch (_) {
      // Con titulares ya en pantalla se dejan tal cual (no caducan en minutos); sin ellos sale el aviso con "Reintentar".
      state.news = state.news.items.length ? { ...state.news, at: Date.now() } : { status: "error", items: [], at: Date.now() };
    }
    newsBusy = false;
    if (alive) renderNews();
  }

  function renderNews() {
    const { status, items } = state.news;
    if (status === "ready" && items.length) {
      const sig = items.map((it) => it.url).join("|");
      if (newsCard && sig === newsSig) return;
      newsSig = sig;
      newsCard = newsCarousel(items, state.now);
      newsSlot.replaceChildren(newsCard);
      return;
    }
    newsCard = null;
    newsSig = "";
    if (status !== "error") {
      newsSlot.replaceChildren(); // cargando o sin noticias: no se muestra nada
      return;
    }
    newsSlot.replaceChildren(
      h(
        "section",
        { class: "card mk-card", "aria-label": "Noticias del mercado" },
        h("div", { class: "mk-head" }, h("h2", { class: "card-title", text: "Noticias" })),
        h("p", { class: "mk-err", role: "alert", text: "No se pudieron cargar las noticias." }),
        h("button", { type: "button", class: "btn btn-ghost", text: "Reintentar", onClick: loadNews }),
      ),
    );
  }

  async function fetchCoin(symbol, { silent = false } = {}) {
    const token = ++fetchToken;
    const keep = silent && state.dataFor === symbol && Boolean(state.data);
    if (!keep) {
      state.status = "loading";
      state.data = null;
      state.dataFor = null;
      state.stale = false;
      state.offline = false;
    }
    render();
    try {
      const res = await getMarket(symbol);
      if (!alive || token !== fetchToken) return;
      state.data = res.market;
      state.dataFor = symbol;
      state.stale = Boolean(res.stale);
      state.status = "ready";
      state.offline = false;
      lastFetch = Date.now();
      save(CACHE_KEY, { symbol, data: res.market, stale: state.stale });
    } catch (e) {
      if (!alive || token !== fetchToken) return;
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
        state.status = "notfound";
        state.data = null;
        state.dataFor = null;
      } else if (e instanceof ApiError && e.status === 0) {
        state.offline = true;
        if (!keep) {
          const saved = load(CACHE_KEY, null);
          if (validCache(saved) && saved.symbol === symbol) {
            state.data = saved.data;
            state.dataFor = symbol;
            state.status = "ready";
          } else {
            state.status = "error";
          }
        }
      } else if (keep) {
        state.stale = true; // se sigue mostrando lo último, con aviso
      } else {
        state.status = "error";
      }
    }
    state.now = Date.now();
    render();
  }

  // ---------- Panorama IA (S10 F3) ----------
  async function generatePanorama(symbol) {
    const current = state.pan.get(symbol);
    if (current && current.status === "loading") return;
    state.pan.set(symbol, { status: "loading" });
    render();
    try {
      const res = await postPanorama(symbol);
      if (!alive) return;
      const paragraphs = panoramaParagraphs(res && res.text);
      state.pan.set(
        symbol,
        paragraphs.length
          ? { status: "ready", paragraphs, disclaimer: res && typeof res.disclaimer === "string" && res.disclaimer ? res.disclaimer : PANORAMA_DISCLAIMER }
          : { status: "error", message: panoramaError({ status: 503 }), retry: true },
      );
    } catch (e) {
      if (!alive) return;
      const status = e instanceof ApiError ? e.status : 503;
      state.pan.set(symbol, { status: "error", message: panoramaError({ status }), retry: status !== 429 && status !== 401 });
    }
    state.now = Date.now();
    render();
  }

  // ---------- Render ----------
  function renderInputError() {
    errorSlot.textContent = state.inputError;
    errorSlot.hidden = !state.inputError;
  }

  function coinTile(symbol) {
    const entry = chartOf(symbol, SPARK_RANGE);
    const series = entry ? entry.series : [];
    const change = rangeChange(series);
    return h(
      "button",
      { type: "button", class: "mk-coin", "aria-pressed": symbol === state.symbol ? "true" : "false", onClick: () => select(symbol) },
      h("span", { class: "mk-coin-sym", text: symbol }),
      change
        ? h(
            "span",
            { class: `mk-coin-chg mono chg-${change.kind}` },
            h("span", { "aria-hidden": "true", text: `${ARROW[change.kind]} ` }),
            pct(change.percent),
            h("span", { class: "sr-only", text: ` (${WORD[change.kind]})` }),
          )
        : null,
      seriesSparkline(series),
    );
  }

  function renderTicker() {
    // Una moneda buscada que no está en el top se antepone para que la selección siempre sea visible.
    const symbols = state.top.includes(state.symbol) ? state.top : [state.symbol, ...state.top];
    tickerSlot.replaceChildren(...symbols.map(coinTile));
    if (tickerFocus === state.symbol) return; // solo se centra al cambiar de moneda: no pelea con el desplazamiento del usuario
    tickerFocus = state.symbol;
    const on = tickerSlot.querySelector('[aria-pressed="true"]');
    if (on && typeof on.scrollIntoView === "function") {
      try {
        on.scrollIntoView({ block: "nearest", inline: "nearest", container: "nearest" }); // container: solo mueve la tira, no la página
      } catch (_) {
        /* navegador sin esa opción: se queda donde está */
      }
    }
  }

  function renderRanges() {
    for (const btn of rangeBar.children) btn.setAttribute("aria-pressed", btn.dataset.range === state.range ? "true" : "false");
  }

  function renderChart() {
    const entry = chartOf(state.symbol, state.range);
    const series = entry ? entry.series : [];
    const change = rangeChange(series);
    const label = RANGES.find((r) => r.id === state.range).label;
    rangeChg.replaceChildren(
      ...(change
        ? [
            h(
              "span",
              { class: `mono chg-${change.kind}` },
              h("span", { "aria-hidden": "true", text: `${ARROW[change.kind]} ` }),
              change.text,
              h("span", { class: "sr-only", text: ` (${WORD[change.kind]})` }),
            ),
            h("span", { class: "mk-label", text: label }),
          ]
        : []),
    );
    if (series.length >= 2) {
      const read = h("p", { class: "mk-read ch-read", text: READ_HINT });
      const svg = priceChart(series, {
        label: `Gráfica de ${state.symbol}, ${label}`,
        rangeId: state.range,
        onReadout: (r) => {
          read.textContent = r ? readoutText(r.time, r.value, state.range) : READ_HINT;
        },
      });
      chartBox.setAttribute("aria-busy", entry && entry.status === "loading" ? "true" : "false");
      chartBox.replaceChildren(svg, read);
    } else if (!entry || entry.status === "loading") {
      chartBox.setAttribute("aria-busy", "true");
      chartBox.replaceChildren(h("div", { class: "skeleton mk-chart-skel", "aria-hidden": "true" }));
    } else if (entry.status === "error") {
      chartBox.setAttribute("aria-busy", "false");
      chartBox.replaceChildren(
        h("p", { class: "mk-err", role: "alert", text: "No se pudo cargar la gráfica." }),
        h("button", { type: "button", class: "btn btn-ghost", text: "Reintentar", onClick: () => loadChart(state.symbol, state.range, { force: true }) }),
      );
    } else {
      chartBox.setAttribute("aria-busy", "false");
      chartBox.replaceChildren(h("p", { class: "mk-ai-hint", text: `No hay gráfica de ${state.symbol}.` }));
    }
  }

  function renderChrome() {
    const m = state.status === "ready" ? state.data : null;
    ctx.setSubtitle(m && m.fetched_at ? `Actualizado ${fmt.relative(m.fetched_at, state.now)}` : "Precios en dólares (USD)");
    const banner = m
      ? marketBanner({ stale: state.stale, fetchedAt: m.fetched_at, now: state.now, offline: state.offline || navigator.onLine === false })
      : null;
    bannerSlot.replaceChildren(...(banner ? [h("div", { class: "notice", role: "status", text: banner.text })] : []));
    if (newsCard) newsCard.refreshMeta(state.now); // solo las horas ("hace 2 h"): no toca el desplazamiento
  }

  function row(r) {
    return h(
      "div",
      { class: "mk-row" },
      h("dt", { class: "mk-label", text: r.label }),
      h("dd", { class: "mk-val mono" }, r.value, r.sub ? h("small", { class: "mk-sub", text: r.sub }) : null),
    );
  }

  function panoramaCard(m) {
    const p = state.pan.get(m.symbol) || { status: "idle" };
    const go = () => generatePanorama(m.symbol);
    let body;
    if (p.status === "loading") {
      body = [h("p", { class: "mk-ai-wait", role: "status", text: `Generando el panorama de ${m.symbol}…` }), h("div", { class: "skeleton", "aria-hidden": "true" })];
    } else if (p.status === "ready") {
      body = [...p.paragraphs.map((t) => h("p", { class: "mk-ai-p", text: t })), h("p", { class: "note", text: p.disclaimer })];
    } else if (p.status === "error") {
      body = [h("p", { class: "mk-err", role: "alert", text: p.message }), p.retry ? h("button", { type: "button", class: "btn btn-ghost", text: "Reintentar", onClick: go }) : null];
    } else if (ctx.session && ctx.session.loggedIn === false) {
      // El Panorama IA gasta cuota por usuario: pide identidad (en la web, entrar con Telegram desde Perfil).
      body = [
        h("p", { class: "mk-ai-hint", text: "El Panorama IA es para quienes han iniciado sesión." }),
        h("a", { class: "btn", href: "#/perfil", text: "Iniciar sesión" }),
      ];
    } else {
      body = [
        h("p", { class: "mk-ai-hint", text: `Un comentario en lenguaje sencillo sobre cómo se mueve ${m.symbol}.` }),
        h("button", { type: "button", class: "btn", text: "Generar Panorama IA", onClick: go }),
      ];
    }
    return h(
      "section",
      { class: "card mk-card", "aria-label": "Panorama IA", "aria-busy": p.status === "loading" ? "true" : "false" },
      h("div", { class: "mk-head" }, h("h2", { class: "card-title", text: "Panorama IA" }), h("span", { class: "mk-src", text: "Groq" })),
      ...body,
    );
  }

  function coinCard(m) {
    const chg = changes(m);
    const rows = detailRows(m);
    const extra = extraRows(m);
    const note = sourceNote(m);
    const hasRank = Number.isInteger(m.rank) && m.rank > 0;
    renderRanges();
    renderChart();
    return h(
      "div",
      { class: "mk-stack" },
      h(
        "section",
        { class: "card mk-card", "aria-label": `Datos de ${m.symbol}` },
        h(
          "div",
          { class: "mk-head" },
          h("div", { class: "mk-id" }, h("span", { class: "mk-symbol", text: m.symbol }), m.name ? h("span", { class: "mk-name", text: m.name }) : null),
          hasRank ? h("span", { class: "mk-rank", text: `#${m.rank}`, title: "Posición por capitalización" }) : null,
        ),
        h("div", { class: "mk-pricerow" }, h("div", { class: "mk-price mono", text: usd(m.price) }), rangeChg),
        rangeBar,
        chartBox,
        chg.length
          ? h(
              "ul",
              { class: "mk-chg" },
              chg.map((c) =>
                h(
                  "li",
                  { class: "mk-chg-item" },
                  h("span", { class: "mk-label", text: c.label }),
                  h(
                    "span",
                    { class: `mono chg-${c.kind}` },
                    h("span", { "aria-hidden": "true", text: `${ARROW[c.kind]} ` }),
                    c.text,
                    h("span", { class: "sr-only", text: ` (${WORD[c.kind]})` }),
                  ),
                ),
              ),
            )
          : null,
        rows.length ? h("dl", { class: "mk-rows mk-grid" }, rows.map(row)) : null,
      ),
      panoramaCard(m),
      extra.length
        ? h(
            "section",
            { class: "card mk-card", "aria-label": "Más datos" },
            h("div", { class: "mk-head" }, h("h2", { class: "card-title", text: "Más datos" }), h("span", { class: "mk-src", text: "CoinGecko" })),
            h("dl", { class: "mk-rows" }, extra.map(row)),
          )
        : null,
      note ? h("p", { class: "note", text: note }) : null,
    );
  }

  function renderContent() {
    if (state.status === "loading") {
      content.replaceChildren(h("div", { class: "mk-stack", "aria-busy": "true" }, h("div", { class: "skeleton tall" }), h("div", { class: "skeleton" })));
      return;
    }
    if (state.status === "notfound") {
      content.replaceChildren(
        h(
          "div",
          { class: "card center" },
          h("p", { text: `No encontré la moneda ${state.symbol}.` }),
          h("p", { class: "sub", text: "Revisa el símbolo (por ejemplo BTC, ETH o SOL) e inténtalo otra vez." }),
        ),
      );
      return;
    }
    if (state.status === "error") {
      const message = state.offline || navigator.onLine === false ? `Sin conexión y sin datos guardados de ${state.symbol}.` : `No se pudieron cargar los datos de ${state.symbol}.`;
      content.replaceChildren(
        h("div", { class: "card center" }, h("p", { text: message }), h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => fetchCoin(state.symbol) })),
      );
      return;
    }
    content.replaceChildren(coinCard(state.data));
  }

  function render() {
    renderChrome();
    renderTicker();
    renderInputError();
    renderContent();
  }

  // ---------- Vida de la pantalla ----------
  const refreshIfDue = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - state.news.at > NEWS_TTL_MS) loadNews(); // con su propio TTL, aunque la moneda no haya cargado
    if (state.status !== "ready") return;
    if (Date.now() - lastFetch > REFRESH_MS) {
      fetchCoin(state.symbol, { silent: true });
      loadChart(state.symbol, state.range, { force: true });
      for (const symbol of state.top) loadChart(symbol, SPARK_RANGE); // con su propio TTL: solo pide las que ya caducaron
    }
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    state.now = Date.now();
    renderChrome();
    refreshIfDue();
  };
  const onOnline = () => {
    state.offline = false;
    if (state.status === "ready") fetchCoin(state.symbol, { silent: true });
    else if (state.status === "error") fetchCoin(state.symbol);
  };
  const onOffline = () => renderChrome();
  const tick = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    state.now = Date.now();
    renderChrome();
    refreshIfDue();
  }, TICK_MS);

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  render();
  fetchCoin(state.symbol);
  loadCharts(state.symbol);
  loadNews();
  // El top 5 llega aparte: si falla, quedan las de semilla y la pantalla funciona igual. Con la lista final se piden sus minigráficas.
  getMarketTop()
    .then((res) => {
      if (alive) state.top = cleanTop(res && res.symbols);
    })
    .catch(() => {})
    .finally(() => {
      if (!alive) return;
      renderTicker();
      for (const symbol of state.top) loadChart(symbol, SPARK_RANGE);
    });

  return () => {
    alive = false;
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
