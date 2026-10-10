// Pestaña Combustible: precios por tipo (rango mín–máx), aviso de datos viejos y estados de carga/error.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). La lógica pura vive en modules/fuel.js.
import { ApiError, getFuel } from "../modules/api.js";
import { h, icon, ICONS } from "../modules/dom.js";
import * as fmt from "../modules/format.js";
import { fuelBanner, fuelRange, metaFor } from "../modules/fuel.js";
import { load, save } from "../modules/storage.js";

const FUEL_KEY = "tasalo:fuel";
const REFRESH_MS = 5 * 60 * 1000; // refresco automático mientras la pestaña está visible
const FOCUS_REFRESH_MS = 2 * 60 * 1000; // al volver a la app, solo si lo guardado tiene más de esto
const TICK_MS = 30 * 1000; // «hace X min» se reescribe sin pedir nada

function validCache(cache) {
  return Boolean(cache && typeof cache === "object" && cache.data && Array.isArray(cache.data.items));
}

/**
 * Monta la pestaña. ctx = { view, actions, setSubtitle }.
 * Devuelve la función que la desmonta (quita temporizadores y escuchas).
 */
export function mount(ctx) {
  const cache = load(FUEL_KEY, null);
  const state = {
    data: validCache(cache) ? cache.data : null,
    savedAt: validCache(cache) && Number.isFinite(cache.savedAt) ? cache.savedAt : 0,
    apiError: false,
    offlineError: false,
    refreshing: false,
    now: Date.now(),
  };
  let alive = true;
  let lastFetch = state.savedAt;

  // ---------- Esqueleto fijo de la pantalla (los huecos se rellenan al renderizar) ----------
  const bannerSlot = h("div", { class: "slot" });
  const content = h("div", { class: "slot" });
  ctx.view.replaceChildren(bannerSlot, content);

  const refreshBtn = h(
    "button",
    { type: "button", class: "icon-btn", "aria-label": "Actualizar combustible", onClick: () => refresh() },
    icon(...ICONS.refresh),
  );
  ctx.actions.replaceChildren(refreshBtn);

  // ---------- Datos ----------
  async function refresh() {
    if (state.refreshing || !alive) return;
    state.refreshing = true;
    renderChrome();
    renderContent();
    try {
      const data = await getFuel();
      if (!alive) return;
      state.data = data;
      state.apiError = false;
      state.offlineError = false;
      state.now = Date.now();
      lastFetch = state.now;
      state.savedAt = state.now;
      save(FUEL_KEY, { data, savedAt: state.savedAt });
    } catch (e) {
      if (!alive) return;
      state.now = Date.now();
      state.offlineError = e instanceof ApiError && e.status === 0;
      state.apiError = !state.offlineError;
    }
    state.refreshing = false;
    render();
  }

  // ---------- Render ----------
  function renderChrome() {
    const fetchedAt = state.data ? state.data.fetched_at : null;
    ctx.setSubtitle(fetchedAt ? `Actualizado ${fmt.relative(fetchedAt, state.now)}` : state.data ? "Sin marca de actualización" : "");
    refreshBtn.disabled = state.refreshing;
    refreshBtn.classList.toggle("spinning", state.refreshing);

    const banner = state.data
      ? fuelBanner({
          fetchedAt,
          now: state.now,
          offline: state.offlineError || navigator.onLine === false,
          apiError: state.apiError,
          stale: Boolean(state.data.stale),
        })
      : null;
    bannerSlot.replaceChildren(...(banner ? [h("div", { class: "notice", role: "status", text: banner.text })] : []));
  }

  function fuelCard(item) {
    const meta = metaFor(item.key);
    const range = fuelRange(item);
    const kind = item.change === "up" || item.change === "down" ? item.change : "neutral";
    return h(
      "article",
      { class: "fcard", "aria-label": `${meta.name}, ${range} ${meta.unit}, ${fmt.changeDescription(item.change)}` },
      h(
        "div",
        { class: "fc-id" },
        h("div", { class: "fc-name", text: meta.name }),
        meta.subtype ? h("div", { class: "rc-sub", text: meta.subtype }) : null,
      ),
      h(
        "div",
        { class: "fc-end" },
        h("div", { class: "fc-range mono", text: range }),
        h("div", { class: "rc-sub", text: meta.unit }),
        h(
          "div",
          { class: `rc-chg chg-${kind}` },
          h("span", { "aria-hidden": "true", text: fmt.arrow(item.change) }),
          h("span", { class: "sr-only", text: fmt.changeDescription(item.change) }),
        ),
      ),
    );
  }

  function renderContent() {
    if (!state.data) {
      if (state.refreshing || (!state.apiError && !state.offlineError)) {
        content.replaceChildren(
          h("div", { class: "flist", "aria-busy": "true" }, [1, 2, 3].map(() => h("div", { class: "skeleton" }))),
        );
        return;
      }
      content.replaceChildren(
        h(
          "div",
          { class: "card center" },
          h("p", { text: state.offlineError ? "Sin conexión y sin datos guardados." : "No se pudo cargar el combustible." }),
          h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => refresh() }),
        ),
      );
      return;
    }
    if (state.data.items.length === 0) {
      content.replaceChildren(h("p", { class: "empty", text: "Sin datos de combustible" }));
      return;
    }
    content.replaceChildren(h("div", { class: "flist" }, state.data.items.map(fuelCard)));
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
  refresh();

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
