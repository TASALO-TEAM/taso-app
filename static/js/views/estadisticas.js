// Sub-pantalla «Mis estadísticas» (plan Perfil, P4b). Para TODOS los usuarios: lo que el bot y la miniapp saben de TI.
// El servidor identifica al usuario solo por el initData (GET /api/me/stats): aquí nunca viaja un id.
// Sin innerHTML ni estilos en línea (CSP). La lógica pura vive en modules/userstats.js; las barras son las del panel admin.
import { ApiError, getMyStats } from "../modules/api.js";
import { h, icon, ICONS } from "../modules/dom.js";
import {
  allDown, commandRows, coinRows, fmtInt, isEmpty, normalizeWindow, sinceLine, sourceRows, successLabel, WINDOW_LABELS, WINDOWS,
} from "../modules/userstats.js";
import { bars, kpi, section, unavailable } from "./admin.js";
import { backToPerfil } from "./subnav.js";

function botCards(bot, win, now) {
  if (!bot || !bot.ok) return [section("En el bot", unavailable())];
  const since = sinceLine(bot, now);
  const cmds = commandRows(bot);
  const srcs = sourceRows(bot);
  return [
    section(
      `Comandos del bot · ${WINDOW_LABELS[win]}`,
      since ? h("p", { class: "sub", text: since }) : null,
      cmds.length ? bars(cmds, "") : h("p", { class: "sub", text: "No has usado comandos en este periodo." }),
    ),
    srcs.length ? section("Fuentes que más consultas", bars(srcs, "")) : null,
  ];
}

function appCard(app) {
  if (!app || !app.ok) return section("En la miniapp", unavailable());
  const coins = coinRows(app);
  return section(
    "En la miniapp",
    h("p", { class: "sub", text: `${fmtInt(app.mercado_queries)} consultas en Mercado · ${fmtInt(app.alerts_active)} alertas de precio activas${app.alerts_triggered ? ` · ${fmtInt(app.alerts_triggered)} ya avisadas` : ""}` }),
    coins.length ? h("h3", { class: "ad-sub", text: "Monedas que más miras" }) : null,
    coins.length ? bars(coins, "veces") : null,
  );
}

export function mount(ctx) {
  let alive = true;
  let loading = false;
  let data = null;
  let error = null; // null | "offline" | "api"
  let win = normalizeWindow("7d");
  let seq = 0; // una respuesta vieja nunca pisa a una más nueva (cambio rápido de periodo)

  const body = h("div", { class: "ad-body" });
  ctx.view.replaceChildren(backToPerfil(), body);
  ctx.setSubtitle("Tu uso del bot y de la app");
  const refreshBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Actualizar mis estadísticas", onClick: () => load() }, icon(...ICONS.refresh));
  ctx.actions.replaceChildren(refreshBtn);

  const seg = h("div", { class: "seg", role: "group", "aria-label": "Periodo" }, WINDOWS.map((w) =>
    h("button", { type: "button", class: "seg-btn", dataset: { value: w }, text: WINDOW_LABELS[w], onClick: () => { win = w; load(); } })));

  function render() {
    refreshBtn.disabled = loading;
    refreshBtn.classList.toggle("spinning", loading);
    for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.value === win));
    if (!data || allDown(data)) {
      if (loading) return body.replaceChildren(seg, h("div", { class: "skeleton", "aria-busy": "true" }));
      const msg = error === "offline" ? "Sin conexión. No se pudieron cargar tus estadísticas." : "No se pudieron cargar tus estadísticas.";
      return body.replaceChildren(seg, h("div", { class: "card center" }, h("p", { text: msg }), h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => load() })));
    }
    const bot = data.bot && data.bot.ok ? data.bot : null;
    const app = data.app && data.app.ok ? data.app : null;
    body.replaceChildren(
      seg,
      error || data.stale ? h("div", { class: "notice", role: "status", text: "Datos guardados: no se pudo actualizar ahora." }) : null,
      h(
        "div",
        { class: "ad-kpis" },
        kpi("Comandos", bot ? fmtInt(bot.total) : "—"),
        kpi("Con éxito", successLabel(data.bot)),
        kpi("Consultas en Mercado", app ? fmtInt(app.mercado_queries) : "—"),
        kpi("Alertas activas", app ? fmtInt(app.alerts_active) : "—"),
      ),
      isEmpty(data) ? h("div", { class: "card center" }, h("p", { class: "sub", text: "Aún no hay actividad tuya en este periodo." })) : null,
      ...botCards(data.bot, normalizeWindow(data.window), Date.now()),
      appCard(data.app),
    );
  }

  async function load() {
    const mine = ++seq;
    loading = true;
    render();
    try {
      const res = await getMyStats(win);
      if (!alive || mine !== seq) return;
      data = res;
      error = null;
    } catch (e) {
      if (!alive || mine !== seq) return;
      error = e instanceof ApiError && e.status === 0 ? "offline" : "api"; // si ya había datos, se conservan con aviso
    }
    loading = false;
    render();
  }

  render();
  load();

  return () => {
    alive = false;
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
