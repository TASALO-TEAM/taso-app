// Pestaña Tasas: selector de fuente, tarjetas, aviso de datos viejos, año y frase del día, imagen de El Toque.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). La lógica pura vive en modules/*.
import { ApiError, getEltoqueImage, getRates, getYear } from "../modules/api.js";
import { cubaDateKey, cubaParts } from "../modules/cuba-time.js";
import { h, icon, ICONS } from "../modules/dom.js";
import * as fmt from "../modules/format.js";
import {
  bannerFor, DEFAULT_SOURCE, flagFor, nameFor, normalizeSource, SOURCES, sourceById, visibleRates,
} from "../modules/rates.js";
import { hideBack, showBack } from "../modules/sdk.js";
import { load, save } from "../modules/storage.js";
import { compute as computeYear, resolveQuote } from "../modules/year.js";

const SOURCE_KEY = "tasalo:source";
const RATES_KEY = "tasalo:rates";
const QUOTE_KEY = "tasalo:quote";
const REFRESH_MS = 5 * 60 * 1000; // refresco automático mientras la pestaña está visible
const FOCUS_REFRESH_MS = 2 * 60 * 1000; // al volver a la app, solo si lo guardado tiene más de esto
const TICK_MS = 30 * 1000; // «hace X min» se reescribe sin pedir nada
const MONTH_LETTERS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function validCache(cache) {
  return Boolean(cache && typeof cache === "object" && cache.data && cache.data.sources && typeof cache.data.sources === "object");
}

/**
 * Monta la pestaña. ctx = { view, actions, setSubtitle }.
 * Devuelve la función que la desmonta (quita temporizadores y escuchas).
 */
export function mount(ctx) {
  const cache = load(RATES_KEY, null);
  const state = {
    source: normalizeSource(load(SOURCE_KEY, DEFAULT_SOURCE)),
    data: validCache(cache) ? cache.data : null,
    savedAt: validCache(cache) && Number.isFinite(cache.savedAt) ? cache.savedAt : 0,
    year: null,
    apiError: false,
    offlineError: false,
    refreshing: false,
    now: Date.now(),
  };
  let alive = true;
  let lastFetch = state.savedAt;
  let closeImage = null;

  // ---------- Esqueleto fijo de la pantalla (los huecos se rellenan al renderizar) ----------
  const bannerSlot = h("div", { class: "slot" });
  const segButtons = SOURCES.map((s) =>
    h("button", {
      type: "button",
      class: "seg-btn",
      dataset: { source: s.id },
      text: s.title,
      onClick: () => selectSource(s.id),
    }),
  );
  const selector = h("div", { class: "seg", role: "group", "aria-label": "Fuente de las tasas" }, segButtons);
  const content = h("div", { class: "slot" });
  const imageSlot = h("div", { class: "slot" });
  const yearSlot = h("div", { class: "slot" });
  const quoteSlot = h("div", { class: "slot" });
  ctx.view.replaceChildren(bannerSlot, selector, content, imageSlot, yearSlot, quoteSlot);

  const refreshBtn = h(
    "button",
    { type: "button", class: "icon-btn", "aria-label": "Actualizar tasas", onClick: () => refresh() },
    icon(...ICONS.refresh),
  );
  ctx.actions.replaceChildren(refreshBtn);

  // ---------- Datos ----------
  function sourceData() {
    return state.data ? state.data.sources[state.source] || null : null;
  }

  async function refresh() {
    if (state.refreshing || !alive) return;
    state.refreshing = true;
    renderChrome();
    renderContent();
    const [ratesResult, yearResult] = await Promise.allSettled([getRates(), getYear()]);
    if (!alive) return;
    state.now = Date.now();
    state.refreshing = false;
    if (ratesResult.status === "fulfilled") {
      state.data = ratesResult.value;
      state.apiError = false;
      state.offlineError = false;
      lastFetch = state.now;
      state.savedAt = state.now;
      save(RATES_KEY, { data: state.data, savedAt: state.savedAt });
    } else {
      const err = ratesResult.reason;
      state.offlineError = err instanceof ApiError && err.status === 0;
      state.apiError = !state.offlineError;
    }
    if (yearResult.status === "fulfilled") state.year = yearResult.value;
    render();
  }

  function selectSource(id) {
    if (id === state.source) return;
    state.source = normalizeSource(id);
    save(SOURCE_KEY, state.source);
    render();
  }

  // ---------- Render ----------
  function renderChrome() {
    const updatedAt = state.data ? state.data.updated_at : null;
    ctx.setSubtitle(updatedAt ? `Actualizado ${fmt.relative(updatedAt, state.now)}` : "");
    refreshBtn.disabled = state.refreshing;
    refreshBtn.classList.toggle("spinning", state.refreshing);

    for (const btn of segButtons) {
      btn.setAttribute("aria-pressed", btn.dataset.source === state.source ? "true" : "false");
    }

    const sd = sourceData();
    const banner = state.data
      ? bannerFor({
          fetchedAt: (sd && sd.fetched_at) || state.data.updated_at,
          now: state.now,
          offline: state.offlineError || navigator.onLine === false,
          apiError: state.apiError,
          stale: Boolean(state.data.stale),
        })
      : null;
    bannerSlot.replaceChildren(...(banner ? [h("div", { class: "notice", role: "status", text: banner.text })] : []));
  }

  function rateCard(r) {
    const src = sourceById(state.source);
    const flag = flagFor(state.source, r.code);
    const buy = r.buy === null || r.buy === undefined ? "—" : fmt.rate(r.buy);
    const sell = r.sell === null || r.sell === undefined ? "—" : fmt.rate(r.sell);
    const showBuySell = src.hasBuySell && (r.buy !== null || r.sell !== null);
    const kind = r.change === "up" || r.change === "down" ? r.change : "neutral";
    return h(
      "article",
      { class: "rcard" },
      h("div", { class: "rc-head" }, flag ? h("span", { class: "rc-flag", "aria-hidden": "true", text: flag }) : null, h("span", { class: "rc-code", text: r.code })),
      h("div", { class: "rc-name", text: nameFor(state.source, r.code) }),
      h("div", { class: "rc-rate mono", text: fmt.rate(r.rate) }),
      state.source === "qvapay" ? h("div", { class: "rc-sub", text: "por 1 USD" }) : null,
      showBuySell ? h("div", { class: "rc-sub mono", text: `Compra ${buy} · Venta ${sell}` }) : null,
      h(
        "div",
        { class: `rc-chg chg-${kind}` },
        h("span", { "aria-hidden": "true", text: fmt.change(r) }),
        h("span", { class: "sr-only", text: fmt.changeDescription(r.change) }),
      ),
    );
  }

  function renderContent() {
    if (!state.data) {
      if (state.refreshing || (!state.apiError && !state.offlineError)) {
        content.replaceChildren(
          h("div", { class: "grid", "aria-busy": "true" }, [1, 2, 3, 4].map(() => h("div", { class: "skeleton" }))),
        );
        return;
      }
      content.replaceChildren(
        h(
          "div",
          { class: "card center" },
          h("p", { text: state.offlineError ? "Sin conexión y sin datos guardados." : "No se pudieron cargar las tasas." }),
          h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => refresh() }),
        ),
      );
      return;
    }
    const rates = visibleRates(sourceData(), state.source, null);
    if (rates.length === 0) {
      content.replaceChildren(h("p", { class: "empty", text: "Sin datos para esta fuente" }));
      return;
    }
    content.replaceChildren(h("div", { class: "grid" }, rates.map(rateCard)));
  }

  function renderImageButton() {
    const available = state.source === "eltoque" && state.data && state.data.image && state.data.image.available;
    imageSlot.replaceChildren(
      ...(available
        ? [h("button", { type: "button", class: "btn-ghost", onClick: openImage }, icon(...ICONS.image), "Ver imagen de El Toque")]
        : []),
    );
  }

  function renderYear() {
    const y = computeYear(state.now, state.year);
    const month = cubaParts(state.now).month;
    yearSlot.replaceChildren(
      h(
        "section",
        { class: "card year", "aria-label": `Año ${y.year}` },
        h(
          "div",
          { class: "year-head" },
          h("h2", { class: "card-title", text: `Año ${y.year}` }),
          h("span", { class: "mono", text: `${fmt.percent(y.percent)} completado` }),
        ),
        h(
          "div",
          {
            class: "bar",
            role: "progressbar",
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            "aria-valuenow": String(Math.round(y.percent)),
            "aria-label": "Progreso del año",
          },
          h("div", { class: "bar-fill", vars: { "--p": y.percent.toFixed(2) } }),
        ),
        h(
          "div",
          { class: "months", "aria-hidden": "true" },
          MONTH_LETTERS.map((letter, i) => h("span", { class: i + 1 === month ? "on" : null, text: letter })),
        ),
        h("p", { class: "sub", text: `Transcurridos ${y.daysPassed} · Restantes ${y.daysLeft} · Semanas restantes ${y.weeksLeft}` }),
      ),
    );
  }

  function renderQuote() {
    const stored = load(QUOTE_KEY, null) || {};
    const fetched = state.year && state.year.quote ? state.year.quote : null;
    const [quote, date] = resolveQuote(stored.text, stored.date, fetched, cubaDateKey(state.now));
    if (quote && (quote !== stored.text || date !== stored.date)) save(QUOTE_KEY, { text: quote, date });
    quoteSlot.replaceChildren(
      ...(quote
        ? [h("section", { class: "card quote" }, h("h2", { class: "label", text: "Frase del día" }), h("p", { class: "quote-text", text: `“${quote}”` }))]
        : []),
    );
  }

  function render() {
    renderChrome();
    renderContent();
    renderImageButton();
    renderYear();
    renderQuote();
  }

  // ---------- Imagen de El Toque (overlay) ----------
  function openImage() {
    if (closeImage) return;
    const opener = document.activeElement;
    let objectUrl = null;
    const loadingNodes = () => [h("div", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "sub", text: "Cargando imagen…" })];
    const body = h("div", { class: "ov-body" }, loadingNodes());
    const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Cerrar imagen", onClick: close }, icon(...ICONS.close));
    const overlay = h(
      "div",
      { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "Imagen de El Toque" },
      h("div", { class: "ov-head" }, h("h2", { class: "ov-title", text: "Imagen de El Toque" }), closeBtn),
      body,
    );
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };

    function close() {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      document.removeEventListener("keydown", onKey);
      hideBack();
      overlay.remove();
      closeImage = null;
      if (opener && typeof opener.focus === "function") opener.focus();
    }

    async function loadImage() {
      body.replaceChildren(...loadingNodes());
      try {
        const blob = await getEltoqueImage();
        if (!closeImage) return;
        objectUrl = URL.createObjectURL(blob);
        body.replaceChildren(h("img", { class: "ov-img", src: objectUrl, alt: "Imagen de tasas publicada por El Toque" }));
      } catch (e) {
        if (!closeImage) return;
        const message = e instanceof ApiError && e.status === 404 ? "Todavía no hay imagen disponible." : "No se pudo cargar la imagen.";
        body.replaceChildren(h("p", { text: message }), h("button", { type: "button", class: "btn", text: "Reintentar", onClick: loadImage }));
      }
    }

    closeImage = close;
    document.addEventListener("keydown", onKey);
    document.getElementById("app").append(overlay);
    showBack(close);
    closeBtn.focus();
    loadImage();
  }

  // ---------- Vida de la pantalla ----------
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    state.now = Date.now();
    renderChrome();
    if (state.now - lastFetch > FOCUS_REFRESH_MS) refresh();
  };
  const onOnline = () => {
    state.offlineError = false;
    refresh();
  };
  const onOffline = () => renderChrome();
  const tick = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    state.now = Date.now();
    renderChrome();
    renderYear();
    if (state.now - lastFetch > REFRESH_MS) refresh();
  }, TICK_MS);

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  render();
  refresh();

  return () => {
    alive = false;
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    if (closeImage) closeImage();
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
