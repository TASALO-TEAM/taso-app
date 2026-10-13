// Sub-pantalla Ajustes (plan Perfil, P3). Se abre con el engranaje de Perfil. Todo se guarda al tocar (local + CloudStorage).
// Apariencia (tema, colores sube/baja en Tasas y en Mercado), Tasas (fuente de inicio, monedas visibles) y Acerca de.
// Sin innerHTML ni estilos en línea (CSP). La lógica pura vive en modules/settings.js.
import { getRates } from "../modules/api.js";
import { h, icon, ICONS } from "../modules/dom.js";
import { DEFAULT_SOURCE, flagFor, nameFor, normalizeSource, SOURCES, visibleRates } from "../modules/rates.js";
import { applyTheme, haptic, openLink } from "../modules/sdk.js";
import { getSettings, hiddenCount, hiddenKey, hiddenSet, updateSettings, withHidden } from "../modules/settings.js";
import { load, save } from "../modules/storage.js";
import { backToPerfil } from "./subnav.js";

const SOURCE_KEY = "tasalo:source"; // la misma clave que lee Tasas: «fuente de inicio» = la fuente con la que abre
const RATES_KEY = "tasalo:rates";
const meta = (name) => {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.getAttribute("content") || "" : "";
};

/** Selector segmentado accesible (mismas clases que el de Tasas). Devuelve { el, set }. */
function segmented(label, options, value, onPick) {
  const buttons = options.map((o) =>
    h("button", { type: "button", class: "seg-btn", dataset: { value: o.value }, text: o.label, onClick: () => { set(o.value); onPick(o.value); } }),
  );
  const el = h("div", { class: "seg", role: "group", "aria-label": label }, buttons);
  function set(v) {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === v)));
  }
  set(value);
  return { el, set };
}

const section = (title, ...children) => h("section", { class: "card aj-card" }, h("h2", { class: "card-title", text: title }), ...children);
const row = (label, hint, control) =>
  h("div", { class: "aj-row" }, h("div", { class: "aj-label" }, h("span", { text: label }), hint ? h("span", { class: "sub", text: hint }) : null), control);

export function mount(ctx) {
  let alive = true;
  let ratesData = null;
  let panelOpen = false;
  let panelSource = normalizeSource(load(SOURCE_KEY, DEFAULT_SOURCE));
  const cached = load(RATES_KEY, null);
  if (cached && cached.data && cached.data.sources) ratesData = cached.data;

  // ---------- Apariencia ----------
  const theme = segmented(
    "Tema",
    [{ value: "auto", label: "Automático" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }],
    getSettings().theme,
    (v) => { updateSettings({ theme: v }); applyTheme(); haptic("select"); },
  );
  const invert = segmented(
    "Colores de subida y bajada",
    [{ value: "off", label: "Sube en rojo" }, { value: "on", label: "Sube en verde" }],
    getSettings().invert ? "on" : "off",
    (v) => { updateSettings({ invert: v === "on" }); applyTheme(); haptic("select"); },
  );
  const market = segmented(
    "Colores de subida y bajada en Mercado",
    [{ value: "auto", label: "Como Tasas" }, { value: "red", label: "Sube en rojo" }, { value: "green", label: "Sube en verde" }],
    getSettings().marketUp,
    (v) => { updateSettings({ marketUp: v }); applyTheme(); haptic("select"); },
  );
  const arrows = (cls) => h("p", { class: `aj-preview ${cls}`.trim(), "aria-hidden": "true" }, h("span", { class: "aj-up", text: "▲ +1,2 %" }), h("span", { class: "aj-down", text: "▼ −0,8 %" }));
  const preview = arrows("");
  const previewMarket = arrows("aj-mk");

  // ---------- Tasas ----------
  const startSource = segmented(
    "Fuente de inicio",
    SOURCES.map((s) => ({ value: s.id, label: s.title })),
    normalizeSource(load(SOURCE_KEY, DEFAULT_SOURCE)),
    (v) => { save(SOURCE_KEY, normalizeSource(v)); haptic("select"); },
  );
  const toggleBtn = h("button", { type: "button", class: "card acard aj-toggle", "aria-expanded": "false", onClick: () => { panelOpen = !panelOpen; renderPanel(); } });
  const panel = h("div", { class: "aj-panel", hidden: true });
  const panelNote = h("p", { class: "note", role: "status", hidden: true });

  function renderToggle() {
    toggleBtn.replaceChildren(
      h("span", { class: "acard-main" }, h("span", { class: "card-title", text: "Monedas visibles" }), h("span", { class: "sub", text: "Elige cuáles se ven en Tasas y Calculadora" })),
      h("span", { class: `pill pill-${getHiddenTotal() ? "on" : "off"}`, text: getHiddenTotal() ? `${getHiddenTotal()} ocultas` : "Todas" }),
      icon(...(panelOpen ? ICONS.close : ICONS.chevron)),
    );
  }
  const getHiddenTotal = () => getSettings().hidden.length;

  function renderPanel() {
    toggleBtn.setAttribute("aria-expanded", String(panelOpen));
    panel.hidden = !panelOpen;
    renderToggle();
    if (!panelOpen) return;
    const seg = segmented("Fuente de las monedas", SOURCES.map((s) => ({ value: s.id, label: s.title })), panelSource, (v) => { panelSource = v; renderPanel(); });
    const sd = ratesData && ratesData.sources ? ratesData.sources[panelSource] || null : null;
    const rates = sd ? visibleRates(sd, panelSource, null) : [];
    const hidden = hiddenSet(getSettings());
    panelNote.hidden = true;
    const items = rates.map((r) => {
      const input = h("input", { type: "checkbox", class: "aj-check", "aria-label": `${r.code}, ${nameFor(panelSource, r.code)}`, checked: !hidden.has(hiddenKey(panelSource, r.code)) });
      input.addEventListener("change", () => {
        const hide = !input.checked;
        const visibleNow = rates.length - hiddenCount(getSettings(), panelSource);
        if (hide && visibleNow <= 1) {
          input.checked = true; // al menos una moneda por fuente, o Tasas quedaría vacía
          panelNote.textContent = "Deja al menos una moneda visible en esta fuente.";
          panelNote.hidden = false;
          return;
        }
        updateSettings(withHidden(getSettings(), panelSource, r.code, hide));
        panelNote.hidden = true;
        renderToggle();
        haptic("select");
      });
      const flag = flagFor(panelSource, r.code);
      return h("label", { class: "aj-coin" }, flag ? h("span", { class: "rc-flag", "aria-hidden": "true", text: flag }) : null, h("span", { class: "rc-code", text: r.code }), h("span", { class: "sub aj-coin-name", text: nameFor(panelSource, r.code) }), input);
    });
    panel.replaceChildren(
      seg.el,
      panelNote,
      items.length ? h("div", { class: "aj-coins" }, items) : h("p", { class: "empty", text: ratesData ? "Sin datos para esta fuente." : "Cargando monedas." }),
    );
  }

  // ---------- Acerca de ----------
  const version = meta("tasalo-version");
  const bot = meta("tasalo-bot");
  const about = section(
    "Acerca de",
    row("Versión", null, h("span", { class: "sub", text: version || "—" })),
    row("Desarrollo", null, h("span", { class: "sub", text: "TASALO TEAM" })),
    bot ? h("button", { type: "button", class: "btn btn-ghost block", text: `Abrir @${bot}`, onClick: () => openLink(`https://t.me/${bot}`) }) : null,
  );

  ctx.view.replaceChildren(
    backToPerfil(),
    section(
      "Apariencia",
      row("Tema", null, theme.el),
      row("Subida y bajada", "Los colores de ▲ y ▼ en las tasas", invert.el),
      preview,
      row("Mercado", "Los colores de ▲ y ▼ en las monedas", market.el),
      previewMarket,
    ),
    section("Tasas", row("Fuente de inicio", "La que se abre primero en Tasas", startSource.el), toggleBtn, panel),
    about,
  );
  ctx.setSubtitle("Apariencia y tasas");
  ctx.actions.replaceChildren();
  renderPanel();

  // Las monedas salen de /rates (ya cacheado en servidor); si falla se usa lo guardado por Tasas.
  getRates()
    .then((res) => {
      if (!alive || !res || !res.sources) return;
      ratesData = res;
      if (panelOpen) renderPanel();
    })
    .catch(() => {});

  return () => {
    alive = false;
    ctx.setSubtitle("");
  };
}
