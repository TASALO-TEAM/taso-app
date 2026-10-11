// Pestaña Calculadora: convierte entre las monedas de una fuente con las tasas que ya tiene la app.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). La lógica pura vive en modules/converter.js.
// El campo de monto se crea una sola vez: al teclear solo se actualizan resultado y recibo (no pierde el foco).
import { ApiError, getRates } from "../modules/api.js";
import { copyText } from "../modules/clipboard.js";
import {
  amount as fmtAmount, buildTable, codesOf, convert, parseAmount, receipt, resolvePair, sanitizeAmount,
} from "../modules/converter.js";
import { h, icon, ICONS } from "../modules/dom.js";
import * as fmt from "../modules/format.js";
import {
  bannerFor, DEFAULT_SOURCE, flagFor, nameFor, normalizeSource, SOURCES, sourceById, visibleRates,
} from "../modules/rates.js";
import { shareText } from "../modules/sdk.js";
import { load, save } from "../modules/storage.js";

const RATES_KEY = "tasalo:rates"; // misma caché que Tasas: abrir la calculadora no obliga a pedir de nuevo
const CALC_KEY = "tasalo:calc";
const REFRESH_MS = 5 * 60 * 1000;
const FOCUS_REFRESH_MS = 2 * 60 * 1000;
const TICK_MS = 30 * 1000;
const STATUS_MS = 2500;

function validCache(cache) {
  return Boolean(cache && typeof cache === "object" && cache.data && cache.data.sources && typeof cache.data.sources === "object");
}

/**
 * Monta la pestaña. ctx = { view, actions, setSubtitle }.
 * Devuelve la función que la desmonta (quita temporizadores y escuchas).
 */
export function mount(ctx) {
  const cache = load(RATES_KEY, null);
  const prefs = load(CALC_KEY, null) || {};
  const state = {
    source: normalizeSource(typeof prefs.source === "string" ? prefs.source : DEFAULT_SOURCE),
    from: typeof prefs.from === "string" ? prefs.from : "USD",
    to: typeof prefs.to === "string" ? prefs.to : "CUP",
    amountText: "1",
    data: validCache(cache) ? cache.data : null,
    savedAt: validCache(cache) && Number.isFinite(cache.savedAt) ? cache.savedAt : 0,
    apiError: false,
    offlineError: false,
    refreshing: false,
    now: Date.now(),
  };
  let alive = true;
  let lastFetch = state.savedAt;
  let statusTimer = null;
  let card = null; // referencias a la tarjeta de conversión, creada la primera vez que hay datos

  // ---------- Esqueleto fijo ----------
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
  ctx.view.replaceChildren(bannerSlot, selector, content);

  const refreshBtn = h(
    "button",
    { type: "button", class: "icon-btn", "aria-label": "Actualizar tasas", onClick: () => refresh() },
    icon(...ICONS.refresh),
  );
  ctx.actions.replaceChildren(refreshBtn);

  // ---------- Datos ----------
  async function refresh() {
    if (state.refreshing || !alive) return;
    state.refreshing = true;
    renderChrome();
    if (!state.data) renderContent();
    try {
      const data = await getRates();
      if (!alive) return;
      state.data = data;
      state.apiError = false;
      state.offlineError = false;
      state.now = Date.now();
      lastFetch = state.now;
      state.savedAt = state.now;
      save(RATES_KEY, { data, savedAt: state.savedAt });
    } catch (e) {
      if (!alive) return;
      state.now = Date.now();
      state.offlineError = e instanceof ApiError && e.status === 0;
      state.apiError = !state.offlineError;
    }
    state.refreshing = false;
    render();
  }

  function selectSource(id) {
    const next = normalizeSource(id);
    if (next === state.source) return;
    state.source = next;
    persist();
    render();
  }

  function persist() {
    save(CALC_KEY, { source: state.source, from: state.from, to: state.to });
  }

  /** Lo que depende de la fuente y de lo guardado: tabla, códigos y par realmente usable. */
  function derive() {
    const sd = state.data ? state.data.sources[state.source] || null : null;
    const table = buildTable(visibleRates(sd, state.source, null), state.source);
    const codes = codesOf(table, state.source);
    const { from, to } = resolvePair(state.from, state.to, codes);
    return { sd, table, codes, from, to };
  }

  function pickFrom(code) {
    const d = derive();
    if (code === d.to) state.to = d.from;
    state.from = code;
    persist();
    update();
  }

  function pickTo(code) {
    const d = derive();
    if (code === d.from) state.from = d.to;
    state.to = code;
    persist();
    update();
  }

  function swap() {
    const d = derive();
    state.from = d.to;
    state.to = d.from;
    persist();
    update();
  }

  // ---------- Render ----------
  function renderChrome() {
    const updatedAt = state.data ? state.data.updated_at : null;
    ctx.setSubtitle(updatedAt ? `Tasas de ${fmt.relative(updatedAt, state.now)}` : "Sin tasas aún");
    refreshBtn.disabled = state.refreshing;
    refreshBtn.classList.toggle("spinning", state.refreshing);
    for (const btn of segButtons) {
      btn.setAttribute("aria-pressed", btn.dataset.source === state.source ? "true" : "false");
    }
    const sd = state.data ? state.data.sources[state.source] || null : null;
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

  function buildCard() {
    const amountInput = h("input", {
      type: "text",
      inputmode: "decimal",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "done",
      class: "conv-amount mono",
      placeholder: "0",
      onInput: () => {
        const clean = sanitizeAmount(amountInput.value);
        if (clean !== amountInput.value) amountInput.value = clean;
        state.amountText = clean;
        update();
      },
      onKeydown: (e) => {
        if (e.key === "Enter") amountInput.blur();
      },
    });
    amountInput.value = state.amountText;
    const clearBtn = h(
      "button",
      {
        type: "button",
        class: "icon-btn",
        "aria-label": "Borrar monto",
        onClick: () => {
          state.amountText = "";
          amountInput.value = "";
          update();
          amountInput.focus();
        },
      },
      icon(...ICONS.close),
    );
    const fromSelect = h("select", { class: "cur-select", onChange: () => pickFrom(fromSelect.value) });
    const toSelect = h("select", { class: "cur-select", onChange: () => pickTo(toSelect.value) });
    const result = h("output", { class: "conv-result mono", "aria-live": "polite" });
    const unit = h("p", { class: "conv-unit" });
    const swapBtn = h(
      "button",
      { type: "button", class: "icon-btn swap", "aria-label": "Invertir monedas", onClick: swap },
      icon(...ICONS.swap),
    );

    const convCard = h(
      "article",
      { class: "card conv" },
      h("div", { class: "conv-row" }, fromSelect, amountInput, clearBtn),
      h("div", { class: "conv-sep" }, h("span", { class: "conv-line" }), swapBtn, h("span", { class: "conv-line" })),
      h("div", { class: "conv-row" }, toSelect, result),
      unit,
    );

    const status = h("span", { class: "inv-status", role: "status" });
    const copyBtn = h(
      "button",
      { type: "button", class: "icon-btn", "aria-label": "Copiar resumen", onClick: () => onCopy() },
      icon(...ICONS.copy),
    );
    const shareBtn = h(
      "button",
      { type: "button", class: "icon-btn", "aria-label": "Compartir resumen", onClick: () => onShare() },
      icon(...ICONS.share),
    );
    const invTitle = h("div", { class: "rc-sub" });
    const rowsBox = h("div", { class: "inv-rows" });
    const invoice = h(
      "article",
      { class: "card inv" },
      h(
        "div",
        { class: "inv-head" },
        h("div", { class: "inv-id" }, h("div", { class: "inv-title", text: "Equivale a" }), invTitle),
        status,
        copyBtn,
        shareBtn,
      ),
      rowsBox,
    );

    return { convCard, invoice, fromSelect, toSelect, amountInput, clearBtn, result, unit, invTitle, rowsBox, status, copyBtn, shareBtn, receiptText: "" };
  }

  function fillSelect(select, codes, selected) {
    select.replaceChildren(
      ...codes.map((code) => {
        const option = h("option", { value: code, text: `${code} · ${nameFor(state.source, code)}` });
        option.selected = code === selected;
        return option;
      }),
    );
    select.value = selected;
  }

  /** Recalcula lo que se ve (par, resultado, unidad y recibo) sin recrear el campo de monto. */
  function update() {
    if (!card) return;
    const d = derive();
    const value = parseAmount(state.amountText);
    const sourceTitle = (sourceById(state.source) || {}).title || "";

    fillSelect(card.fromSelect, d.codes, d.from);
    fillSelect(card.toSelect, d.codes, d.to);
    card.fromSelect.setAttribute("aria-label", `Moneda de origen: ${nameFor(state.source, d.from)}`);
    card.toSelect.setAttribute("aria-label", `Moneda de destino: ${nameFor(state.source, d.to)}`);
    card.amountInput.setAttribute("aria-label", `Monto en ${d.from}`);
    card.clearBtn.hidden = state.amountText === "";

    const usable = d.codes.length >= 2; // con solo el pivote no hay nada que convertir (p. ej. CADECA sin datos)
    const result = value === null || !usable ? null : convert(value, d.from, d.to, d.table);
    card.result.textContent = result === null ? "—" : fmtAmount(result);
    const unitValue = usable ? convert(1, d.from, d.to, d.table) : null;
    card.unit.textContent = unitValue === null ? "" : `1 ${d.from} = ${fmtAmount(unitValue)} ${d.to} · ${sourceTitle}`;

    const rowCodes = d.codes.filter((c) => c !== d.from);
    card.invTitle.textContent = `${value === null ? "—" : fmtAmount(value)} ${d.from}`;
    if (!usable) {
      card.rowsBox.replaceChildren(h("p", { class: "empty", text: "Esta fuente no tiene monedas para convertir." }));
      card.receiptText = "";
      card.copyBtn.disabled = true;
      card.shareBtn.disabled = true;
      return;
    }
    card.rowsBox.replaceChildren(
      ...rowCodes.map((code) => {
        const converted = value === null ? null : convert(value, d.from, code, d.table);
        const flag = flagFor(state.source, code);
        return h(
          "button",
          {
            type: "button",
            class: `inv-row${code === d.to ? " on" : ""}`,
            "aria-label": `${nameFor(state.source, code)}: ${converted === null ? "sin valor" : fmtAmount(converted)}. Usar como destino`,
            onClick: () => pickTo(code),
          },
          h("span", { class: "rc-flag", "aria-hidden": "true", text: flag }),
          h("span", { class: "inv-cur" }, h("span", { class: "rc-code", text: code }), h("span", { class: "rc-name", text: nameFor(state.source, code) })),
          h("span", { class: "inv-val mono", text: converted === null ? "—" : fmtAmount(converted) }),
        );
      }),
    );

    card.receiptText = value === null ? "" : receipt({ value, from: d.from, sourceTitle, table: d.table, rows: rowCodes });
    card.copyBtn.disabled = card.receiptText === "";
    card.shareBtn.disabled = card.receiptText === "";
  }

  function flash(message) {
    if (!card) return;
    card.status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      if (card) card.status.textContent = "";
    }, STATUS_MS);
  }

  async function onCopy() {
    if (!card || !card.receiptText) return;
    flash((await copyText(card.receiptText)) ? "Resumen copiado" : "No se pudo copiar");
  }

  async function onShare() {
    if (!card || !card.receiptText) return;
    const text = card.receiptText;
    if (shareText(text)) return;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // la persona cerró el selector: no es un error
    }
    flash((await copyText(text)) ? "Copiado: pégalo donde quieras" : "No se pudo compartir");
  }

  function renderContent() {
    if (!state.data) {
      if (state.refreshing || (!state.apiError && !state.offlineError)) {
        card = null;
        content.replaceChildren(h("div", { "aria-busy": "true" }, h("div", { class: "skeleton tall" })));
        return;
      }
      card = null;
      content.replaceChildren(
        h(
          "div",
          { class: "card center" },
          h("p", { text: state.offlineError ? "Sin conexión y sin tasas guardadas." : "No hay tasas para calcular todavía." }),
          h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => refresh() }),
        ),
      );
      return;
    }
    if (!card) {
      card = buildCard();
      content.replaceChildren(card.convCard, card.invoice);
    }
    update();
  }

  function render() {
    renderChrome();
    renderContent();
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
    if (state.now - lastFetch > REFRESH_MS) refresh();
  }, TICK_MS);

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  render();
  if (state.now - lastFetch > FOCUS_REFRESH_MS) refresh();

  return () => {
    alive = false;
    clearInterval(tick);
    clearTimeout(statusTimer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
