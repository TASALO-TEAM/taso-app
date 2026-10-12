// Pantalla Mercado (el /p del bot): búsqueda por símbolo, top 5 de monedas más consultadas y tarjeta con los datos.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). El formato y las reglas puras viven en modules/market.js.
import { ApiError, getMarket, getMarketTop } from "../modules/api.js";
import { h, icon, ICONS } from "../modules/dom.js";
import * as fmt from "../modules/format.js";
import { changes, cleanTop, detailRows, extraRows, marketBanner, normalizeSymbol, sourceNote, usd } from "../modules/market.js";
import { hideBack, showBack } from "../modules/sdk.js";
import { load, save } from "../modules/storage.js";

const LAST_KEY = "tasalo:market:last";
const CACHE_KEY = "tasalo:market:cache";
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
 * Devuelve la función que la desmonta (quita temporizadores, escuchas y el botón Atrás).
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
  };
  let alive = true;
  let fetchToken = 0;
  let lastFetch = 0;

  // ---------- Esqueleto fijo (los huecos se rellenan al renderizar; el campo de texto no se recrea) ----------
  const backSlot = h("div", { class: "slot" });
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
  const chipsSlot = h("div", { class: "chips", role: "group", "aria-label": "Monedas más consultadas" });
  const content = h("div", { class: "slot" });
  ctx.view.replaceChildren(backSlot, bannerSlot, form, errorSlot, chipsSlot, content);
  ctx.actions.replaceChildren();

  // ---------- Navegación: Atrás de Telegram o un botón propio si el cliente no lo trae ----------
  const goBack = () => {
    location.hash = "#/tasas";
  };
  if (!showBack(goBack)) {
    backSlot.replaceChildren(h("button", { type: "button", class: "btn-ghost mk-back", onClick: goBack }, "← Volver a Tasas"));
  }

  // ---------- Datos ----------
  function select(symbol, force = false) {
    if (!force && symbol === state.symbol && state.status === "ready" && state.dataFor === symbol) return;
    state.symbol = symbol;
    input.value = symbol;
    save(LAST_KEY, symbol);
    fetchCoin(symbol);
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

  // ---------- Render ----------
  function renderInputError() {
    errorSlot.textContent = state.inputError;
    errorSlot.hidden = !state.inputError;
  }

  function renderChips() {
    chipsSlot.replaceChildren(
      ...state.top.map((symbol) =>
        h("button", {
          type: "button",
          class: "chip",
          "aria-pressed": symbol === state.symbol ? "true" : "false",
          text: symbol,
          onClick: () => select(symbol),
        }),
      ),
    );
  }

  function renderChrome() {
    const m = state.status === "ready" ? state.data : null;
    ctx.setSubtitle(m && m.fetched_at ? `Actualizado ${fmt.relative(m.fetched_at, state.now)}` : "Precios en dólares (USD)");
    const banner = m
      ? marketBanner({ stale: state.stale, fetchedAt: m.fetched_at, now: state.now, offline: state.offline || navigator.onLine === false })
      : null;
    bannerSlot.replaceChildren(...(banner ? [h("div", { class: "notice", role: "status", text: banner.text })] : []));
  }

  function row(r) {
    return h(
      "div",
      { class: "mk-row" },
      h("dt", { class: "mk-label", text: r.label }),
      h("dd", { class: "mk-val mono" }, r.value, r.sub ? h("small", { class: "mk-sub", text: r.sub }) : null),
    );
  }

  function coinCard(m) {
    const chg = changes(m);
    const rows = detailRows(m);
    const extra = extraRows(m);
    const note = sourceNote(m);
    const hasRank = Number.isInteger(m.rank) && m.rank > 0;
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
        h("div", { class: "mk-price mono", text: usd(m.price) }),
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
        rows.length ? h("dl", { class: "mk-rows" }, rows.map(row)) : null,
      ),
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
    renderChips();
    renderInputError();
    renderContent();
  }

  // ---------- Vida de la pantalla ----------
  const refreshIfDue = () => {
    if (document.visibilityState !== "visible" || state.status !== "ready") return;
    if (Date.now() - lastFetch > REFRESH_MS) fetchCoin(state.symbol, { silent: true });
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
  // El top 5 llega aparte: si falla, quedan las de semilla y la pantalla funciona igual.
  getMarketTop()
    .then((res) => {
      if (!alive) return;
      state.top = cleanTop(res && res.symbols);
      renderChips();
    })
    .catch(() => {});

  return () => {
    alive = false;
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    hideBack();
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
