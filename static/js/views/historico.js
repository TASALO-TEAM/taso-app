// Detalle histórico de una moneda (overlay): gráfico por rango, lista diaria y avisos de historial corto.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). La matemática vive en modules/history-math.js.
import { ApiError, getHistoryDaily } from "../modules/api.js";
import { lineChart } from "../modules/charts.js";
import { cubaDateKey } from "../modules/cuba-time.js";
import { h, icon, ICONS } from "../modules/dom.js";
import * as fmt from "../modules/format.js";
import {
  addDays, between, CUSTOM_FETCH_DAYS, CUSTOM_RANGE, DEFAULT_RANGE, dayRows, daysBetween, isDateKey, lastDays,
  LIST_SIZES, normalizeRange, RANGES, rangeById, shortDate, shortHistory, summarize,
} from "../modules/history-math.js";
import { nameFor, sourceById } from "../modules/rates.js";
import { hideBack, showBack } from "../modules/sdk.js";
import { load, save } from "../modules/storage.js";

const RANGE_KEY = "tasalo:hist-range";
const LIST_KEY = "tasalo:hist-list";
const RANGE_OPTIONS = [...RANGES.map((r) => ({ id: r.id, label: r.id })), { id: CUSTOM_RANGE, label: "Fechas" }];
const LIST_OPTIONS = LIST_SIZES.map((n) => ({ id: n, label: n === LIST_SIZES[0] ? `${n} días` : String(n) }));

function chipGroup(options, label, onPick) {
  const buttons = options.map((o) =>
    h("button", { type: "button", class: "chip", dataset: { id: String(o.id) }, text: o.label, onClick: () => onPick(o.id) }),
  );
  const el = h("div", { class: "chips", role: "group", "aria-label": label }, buttons);
  const sync = (current) => {
    for (const b of buttons) b.setAttribute("aria-pressed", b.dataset.id === String(current) ? "true" : "false");
  };
  return { el, sync };
}

function signed(value) {
  return `${value > 0 ? "+" : ""}${fmt.rate(value)}`;
}

function deltaText(row) {
  if (row.change === null) return "";
  return `${fmt.arrow(row.change)} ${fmt.rate(row.delta)}`;
}

/**
 * Abre el detalle de una moneda de una fuente. Devuelve la función que lo cierra.
 * { source, code, rate (valor actual de la tarjeta, opcional), onClose }
 */
export function openHistory({ source, code, rate, onClose }) {
  const src = sourceById(source);
  const opener = document.activeElement;
  const today = () => cubaDateKey(Date.now());

  const savedList = load(LIST_KEY, LIST_SIZES[0]);
  const state = {
    range: normalizeRange(load(RANGE_KEY, DEFAULT_RANGE)),
    listSize: LIST_SIZES.includes(savedList) ? savedList : LIST_SIZES[0],
    from: addDays(today(), -29),
    to: today(),
    status: "loading", // loading | ready | error | offline
    stale: false,
    cache: new Map(), // días pedidos al servidor → puntos
  };
  if (state.range === CUSTOM_RANGE) state.range = DEFAULT_RANGE; // «Fechas» nunca se abre solo
  let alive = true;
  let token = 0;
  let restText = "";

  // ---------- Esqueleto fijo (los huecos se rellenan al renderizar) ----------
  const bigEl = h("div", { class: "dh-big mono", text: Number.isFinite(rate) ? fmt.rate(rate) : "—" });
  const head = h(
    "div",
    { class: "dh" },
    h(
      "div",
      { class: "dh-id" },
      h("p", { class: "dh-name", text: `${nameFor(source, code)} · ${src ? src.title : source}` }),
      h("p", { class: "sub", text: `Precio a las 7:00 (Cuba)${source === "qvapay" ? " · por 1 USD" : ""}` }),
    ),
    bigEl,
  );
  const ranges = chipGroup(RANGE_OPTIONS, "Rango del gráfico", pickRange);
  const lists = chipGroup(LIST_OPTIONS, "Días de la lista", pickListSize);
  const customSlot = h("div", { class: "slot" });
  const chartSlot = h("div", { class: "slot" });
  const listSlot = h("div", { class: "slot" });
  const noteSlot = h("div", { class: "slot" });

  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Cerrar historial", onClick: close }, icon(...ICONS.close));
  const overlay = h(
    "div",
    { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": `Historial de ${code}` },
    h("div", { class: "ov-head" }, h("h2", { class: "ov-title", text: code }), closeBtn),
    h("div", { class: "ov-body top" }, head, ranges.el, customSlot, chartSlot, lists.el, listSlot, noteSlot),
  );

  // ---------- Selector de fechas ----------
  const minDate = addDays(today(), -(CUSTOM_FETCH_DAYS - 1));
  const dateInput = (id, value, onPick) =>
    h("input", {
      type: "date", id, class: "date-input", value, min: minDate, max: today(),
      onChange: (e) => {
        const v = e.target.value;
        if (!isDateKey(v)) return;
        const clamped = v < minDate ? minDate : v > today() ? today() : v;
        e.target.value = clamped;
        onPick(clamped);
        renderData();
      },
    });
  const customBox = h(
    "div",
    { class: "card dh-custom" },
    h("label", { class: "dh-field", for: "hist-from" }, h("span", { class: "sub", text: "Desde" }), dateInput("hist-from", state.from, (v) => (state.from = v))),
    h("label", { class: "dh-field", for: "hist-to" }, h("span", { class: "sub", text: "Hasta" }), dateInput("hist-to", state.to, (v) => (state.to = v))),
  );

  // ---------- Datos ----------
  const fetchDays = () => (state.range === CUSTOM_RANGE ? CUSTOM_FETCH_DAYS : rangeById(state.range).fetchDays);
  const allPoints = () => state.cache.get(fetchDays()) || [];

  function windowPoints() {
    if (state.range === CUSTOM_RANGE) return between(allPoints(), state.from, state.to);
    return lastDays(allPoints(), rangeById(state.range).days, today());
  }

  async function loadPoints() {
    const days = fetchDays();
    if (state.cache.has(days)) {
      state.status = "ready";
      renderData();
      return;
    }
    const mine = ++token;
    state.status = "loading";
    renderData();
    try {
      const res = await getHistoryDaily(source, code, days);
      if (!alive || mine !== token) return;
      state.cache.set(days, Array.isArray(res.points) ? res.points : []);
      state.stale = Boolean(res.stale);
      state.status = "ready";
    } catch (e) {
      if (!alive || mine !== token) return;
      state.status = e instanceof ApiError && e.status === 0 ? "offline" : "error";
    }
    renderData();
  }

  function pickRange(id) {
    if (id === state.range) return;
    state.range = id;
    if (id !== CUSTOM_RANGE) save(RANGE_KEY, id);
    ranges.sync(id);
    customSlot.replaceChildren(...(id === CUSTOM_RANGE ? [customBox] : []));
    loadPoints();
  }

  function pickListSize(n) {
    if (n === state.listSize) return;
    state.listSize = n;
    save(LIST_KEY, n);
    lists.sync(n);
    renderList();
  }

  // ---------- Render ----------
  function setReadout(point) {
    readout.textContent = point ? `${shortDate(point.date)} · ${fmt.rate(point.rate)}` : restText;
  }
  const readout = h("p", { class: "ch-read mono", "aria-live": "off" });

  function problemCard(text) {
    return h(
      "div",
      { class: "card center" },
      h("p", { text }),
      h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => loadPoints() }),
    );
  }

  function renderChart() {
    if (state.status === "loading") {
      chartSlot.replaceChildren(h("div", { class: "skeleton tall", "aria-busy": "true" }));
      return;
    }
    if (state.status !== "ready") {
      chartSlot.replaceChildren(
        problemCard(state.status === "offline" ? "Sin conexión. No se pudo cargar el historial." : "No se pudo cargar el historial."),
      );
      return;
    }
    const points = windowPoints();
    const stats = summarize(points);
    if (!stats) {
      chartSlot.replaceChildren(
        h("p", { class: "empty", text: state.range === CUSTOM_RANGE ? "Sin datos en esas fechas." : "Sin historial para esta moneda." }),
      );
      return;
    }
    const pct = stats.percent === null ? "" : ` (${stats.percent > 0 ? "+" : ""}${fmt.percent(stats.percent)})`;
    const kind = stats.change > 0 ? "up" : stats.change < 0 ? "down" : "neutral";
    restText = `Mín ${fmt.rate(stats.min.rate)} · Máx ${fmt.rate(stats.max.rate)}`;
    readout.textContent = restText;
    const label = `Gráfico de ${shortDate(stats.first.date)} a ${shortDate(stats.last.date)}. Mínimo ${fmt.rate(stats.min.rate)}, máximo ${fmt.rate(stats.max.rate)}.`;
    chartSlot.replaceChildren(
      h(
        "div",
        { class: "card dh-chart" },
        lineChart(points, { label, onReadout: setReadout }),
        h("div", { class: "dh-stats" }, readout, h("p", { class: `mono chg-${kind}`, text: `${signed(stats.change)}${pct}` })),
      ),
    );
  }

  function renderList() {
    if (state.status !== "ready") {
      listSlot.replaceChildren();
      return;
    }
    const rows = dayRows(allPoints(), state.listSize, today());
    if (rows.every((r) => r.rate === null)) {
      listSlot.replaceChildren();
      return;
    }
    listSlot.replaceChildren(
      h(
        "div",
        { class: "card dh-list" },
        rows.map((r) =>
          h(
            "div",
            { class: "drow" },
            h("span", { text: shortDate(r.date) }),
            h("span", { class: r.rate === null ? "mono t2" : "mono", text: r.rate === null ? "sin dato" : fmt.rate(r.rate) }),
            h(
              "span",
              { class: `sub mono drow-chg chg-${r.change || "neutral"}` },
              h("span", { "aria-hidden": "true", text: deltaText(r) }),
              r.change ? h("span", { class: "sr-only", text: fmt.changeDescription(r.change) }) : null,
            ),
          ),
        ),
      ),
    );
  }

  function renderNote() {
    const notes = [];
    if (state.status === "ready") {
      const days = state.range === CUSTOM_RANGE ? (daysBetween(state.from, state.to) ?? 0) + 1 : rangeById(state.range).days;
      const since = shortHistory(windowPoints(), Math.abs(days), state.range === CUSTOM_RANGE ? state.to : today());
      if (since) notes.push(`Historial corto: solo hay datos desde ${shortDate(since)}.`);
      if (state.stale) notes.push("Mostrando el último historial guardado.");
    }
    noteSlot.replaceChildren(...notes.map((text) => h("p", { class: "note", role: "status", text })));
  }

  function renderBig() {
    if (Number.isFinite(rate)) return;
    const stats = summarize(allPoints());
    bigEl.textContent = stats ? fmt.rate(stats.last.rate) : "—";
  }

  function renderData() {
    renderChart();
    renderList();
    renderNote();
    renderBig();
  }

  // ---------- Cierre y vida del overlay ----------
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  function close() {
    if (!alive) return;
    alive = false;
    token += 1;
    document.removeEventListener("keydown", onKey);
    hideBack();
    overlay.remove();
    if (onClose) onClose();
    if (opener && typeof opener.focus === "function") opener.focus();
  }

  ranges.sync(state.range);
  lists.sync(state.listSize);
  document.addEventListener("keydown", onKey);
  document.getElementById("app").append(overlay);
  showBack(close);
  closeBtn.focus();
  loadPoints();
  return close;
}
