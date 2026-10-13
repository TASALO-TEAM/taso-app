// Sub-pantalla «Estado y estadísticas» (plan Perfil, P4). Solo admins: el servidor responde 403 al resto (esto no es la barrera).
// Reúne lo del /status del bot + estadísticas del bot y de la propia miniapp, con barras e indicadores pequeños.
// Sin innerHTML ni estilos en línea (CSP): los anchos van por variable CSS (`vars`). La lógica pura vive en modules/admin.js.
import { ApiError, getAdminOverview } from "../modules/api.js";
import {
  agoLabel, barRows, clientShares, daySeries, fmtInt, fmtMs, fmtPct, healthTone, jobProblems, normalizeWindow, WINDOW_LABELS, WINDOWS,
} from "../modules/admin.js";
import { h, icon, ICONS } from "../modules/dom.js";
import { backToPerfil } from "./subnav.js";

export const section = (title, ...children) => h("section", { class: "card ad-card" }, h("h2", { class: "card-title", text: title }), ...children);
export const unavailable = () => h("p", { class: "sub", text: "No disponible ahora mismo." });

export function bars(rows, unit) {
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return h("p", { class: "sub", text: "Sin datos en este periodo." });
  return h(
    "ul",
    { class: "ad-bars" },
    rows.map((r) =>
      h(
        "li",
        { class: "ad-bar-row" },
        h("span", { class: "ad-bar-label", text: r.label }),
        h("span", { class: "ad-bar-track", "aria-hidden": "true" }, h("span", { class: "ad-bar", vars: { "--w": `${r.pct}%` } })),
        h("span", { class: "ad-bar-value", text: unit ? `${fmtInt(r.value)} ${unit}` : fmtInt(r.value) }),
      ),
    ),
  );
}

export function kpi(label, value) {
  return h("div", { class: "card ad-kpi" }, h("span", { class: "ad-kpi-value", text: value }), h("span", { class: "sub", text: label }));
}

function healthCard(d, now) {
  const t = healthTone(d.health ? d.health.level : "unknown");
  const v = d.versions && d.versions.ok ? `API ${d.versions.api_version}${d.versions.api_commit ? ` · ${d.versions.api_commit}` : ""}` : "";
  const ago = agoLabel(d.fetched_at, now);
  return h(
    "div",
    { class: "card ad-health" },
    h("span", { class: `ad-dot ad-dot-${t.dot}`, "aria-hidden": "true" }),
    h("div", { class: "ad-health-text" }, h("span", { class: "card-title", text: d.health ? d.health.text : "Sin datos" }), h("span", { class: "sub", text: [v, ago ? `Actualizado ${ago}` : ""].filter(Boolean).join(" · ") })),
  );
}

function apiCard(api) {
  if (!api || !api.ok) return section("Uso de la API", unavailable());
  const shares = clientShares(api.by_client);
  return section(
    "Uso de la API",
    h("p", { class: "sub", text: `${fmtInt(api.total_requests)} peticiones · ${fmtInt(api.total_errors)} con error (${fmtPct(api.error_rate)}) · ${fmtMs(api.avg_duration_ms)} de media` }),
    shares.length
      ? h("div", { class: "ad-stack", role: "img", "aria-label": `Reparto por cliente: ${shares.map((s) => `${s.label} ${s.share} %`).join(", ")}` }, shares.filter((s) => s.share > 0).map((s, i) => h("span", { class: `ad-seg ad-seg-${i % 5}`, vars: { "--w": `${s.share}%` } })))
      : null,
    shares.length
      ? h("ul", { class: "ad-legend" }, shares.map((s, i) => h("li", {}, h("span", { class: `ad-swatch ad-seg-${i % 5}`, "aria-hidden": "true" }), h("span", { class: "ad-legend-name", text: s.label }), h("span", { class: "sub", text: `${fmtInt(s.requests)} · ${s.share} %${s.errors ? ` · ${fmtInt(s.errors)} err.` : ""}` }))))
      : null,
  );
}

function schedulerCard(sch) {
  if (!sch || !sch.ok) return section("Tareas programadas", unavailable());
  const problems = jobProblems(sch);
  return section(
    "Tareas programadas",
    h("p", { class: "sub", text: `${sch.running ? "En marcha" : "Detenido"} · ${sch.jobs.length} tareas · ${problems.length ? `${problems.length} con errores` : "sin errores"}` }),
    problems.length
      ? h("ul", { class: "ad-jobs" }, problems.map((j) => h("li", {}, h("span", { class: "ad-job-name", text: `${j.name} · ${fmtInt(j.errors)} err.` }), j.lastError ? h("span", { class: "sub ad-job-err", text: j.lastError }) : null)))
      : null,
  );
}

function appCard(app) {
  if (!app || !app.ok) return section("Miniapp", unavailable());
  const days = daySeries(app.queries_by_day);
  return section(
    `Miniapp · ${app.days} días`,
    h("p", { class: "sub", text: `${fmtInt(app.mercado_users)} usuarios en Mercado · ${fmtInt(app.price_alerts)} alertas de precio` }),
    h("h3", { class: "ad-sub", text: "Consultas por día" }),
    days.length
      ? h("ul", { class: "ad-days", "aria-label": "Consultas de Mercado por día" }, days.map((d) => h("li", { class: "ad-day", "aria-label": `${d.day}: ${d.count}` }, h("span", { class: "ad-day-bar-wrap" }, h("span", { class: "ad-day-bar", vars: { "--h": `${d.pct}%` } })), h("span", { class: "sub", text: d.label }))))
      : null,
    h("h3", { class: "ad-sub", text: "Monedas más consultadas" }),
    bars(barRows((app.coins || []).map((c) => ({ symbol: c.symbol, users: c.users })), "symbol", "users", 5), "usuarios"),
  );
}

export function mount(ctx) {
  let alive = true;
  let loading = false;
  let data = null;
  let error = null; // null | "forbidden" | "offline" | "api"
  let win = normalizeWindow("24h");

  const body = h("div", { class: "ad-body" });
  ctx.view.replaceChildren(backToPerfil(), body);
  ctx.setSubtitle("Bot y miniapp");
  const refreshBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Actualizar estadísticas", onClick: () => load() }, icon(...ICONS.refresh));
  ctx.actions.replaceChildren(refreshBtn);

  const seg = h("div", { class: "seg", role: "group", "aria-label": "Periodo" }, WINDOWS.map((w) =>
    h("button", { type: "button", class: "seg-btn", dataset: { value: w }, text: WINDOW_LABELS[w], onClick: () => { win = w; load(); } })));

  function render() {
    refreshBtn.disabled = loading;
    refreshBtn.classList.toggle("spinning", loading);
    for (const b of seg.children) b.setAttribute("aria-pressed", String(b.dataset.value === win));
    if (!data) {
      if (loading) return body.replaceChildren(h("div", { class: "skeleton", "aria-busy": "true" }));
      const msg = error === "forbidden" ? "Esta sección es solo para administradores." : error === "offline" ? "Sin conexión. No se pudieron cargar las estadísticas." : "No se pudieron cargar las estadísticas.";
      return body.replaceChildren(h("div", { class: "card center" }, h("p", { text: msg }), error === "forbidden" ? null : h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => load() })));
    }
    const u = data.users && data.users.ok ? data.users : null;
    const api = data.api && data.api.ok ? data.api : null;
    const cmds = data.commands && data.commands.ok ? barRows(data.commands.items, "command", "count", 8).map((r) => ({ ...r, label: `/${r.label}` })) : null;
    body.replaceChildren(
      seg,
      error || data.stale ? h("div", { class: "notice", role: "status", text: "Datos guardados: no se pudo actualizar ahora." }) : null,
      healthCard(data, Date.now()),
      h("div", { class: "ad-kpis" }, kpi("Usuarios", u ? fmtInt(u.total) : "—"), kpi("Activos 24 h", u ? fmtInt(u.active_24h) : "—"), kpi("Nuevos 7 d", u ? fmtInt(u.new_7d) : "—"), kpi("Errores API", api ? fmtPct(api.error_rate) : "—")),
      section(`Comandos del bot · ${WINDOW_LABELS[win]}`, cmds ? bars(cmds, "") : unavailable()),
      apiCard(data.api),
      schedulerCard(data.scheduler),
      appCard(data.app),
    );
  }

  async function load() {
    if (loading) return;
    loading = true;
    render();
    try {
      const res = await getAdminOverview(win);
      if (!alive) return;
      data = res;
      error = null;
    } catch (e) {
      if (!alive) return;
      const code = e instanceof ApiError ? e.status : -1;
      if (code === 403) data = null; // si ya había datos y falla un refresco, se conservan (aviso «datos guardados»)
      error = code === 403 ? "forbidden" : code === 0 ? "offline" : "api";
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
