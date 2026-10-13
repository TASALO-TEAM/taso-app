// Sección «Novedades» de Ajustes (plan Perfil, P5): los mensajes del equipo TASALO. Solo lectura.
// El cuerpo es Markdown (o Markdown legacy de Telegram) y se pinta con el parser seguro del Blog: nunca innerHTML.
import { getMessages } from "../modules/api.js";
import { h } from "../modules/dom.js";
import { parse } from "../modules/markdown.js";
import { bodyMarkdown, latestId, normalizeMessages, readSeen, unreadCount, unreadLabel, writeSeen } from "../modules/messages.js";
import { dateLabel } from "../modules/userstats.js";
import { renderBlocks } from "./blog-reader.js";

/** Devuelve { el, destroy }. Carga por su cuenta: si falla, el resto de Ajustes no se entera. */
export function novedadesSection() {
  let alive = true;
  let loading = false;
  const pill = h("span", { class: "pill pill-on", hidden: true });
  const body = h("div", { class: "nv-body" });
  const el = h("section", { class: "card aj-card nv-card" }, h("div", { class: "nv-head" }, h("h2", { class: "card-title", text: "Novedades" }), pill), body);

  function showError() {
    body.replaceChildren(
      h("p", { class: "sub", text: "No se pudieron cargar las novedades." }),
      h("button", { type: "button", class: "btn btn-ghost", text: "Reintentar", onClick: () => load() }),
    );
  }

  function render(items, stale, seen) {
    if (items.length === 0) return body.replaceChildren(h("p", { class: "sub", text: "Sin novedades por ahora." }));
    const unread = unreadCount(items, seen);
    pill.textContent = unreadLabel(unread);
    pill.hidden = unread === 0;
    body.replaceChildren(
      stale ? h("div", { class: "notice", role: "status", text: "Datos guardados: no se pudo actualizar ahora." }) : null,
      h(
        "ul",
        { class: "nv-list" },
        items.map((m) => {
          const date = dateLabel(m.createdAt);
          return h(
            "li",
            { class: "nv-item" },
            h("div", { class: "nv-item-head" }, h("span", { class: "nv-title", text: m.title || "Mensaje del equipo" }), m.id > seen ? h("span", { class: "pill pill-on", text: "Nueva" }) : null),
            date ? h("span", { class: "sub", text: date }) : null,
            h("div", { class: "nv-text md" }, renderBlocks(parse(bodyMarkdown(m)))),
          );
        }),
      ),
    );
  }

  async function load() {
    if (loading) return;
    loading = true;
    body.replaceChildren(h("div", { class: "skeleton", "aria-busy": "true" }));
    try {
      const res = await getMessages();
      if (!alive) return;
      const items = normalizeMessages(res && res.items);
      const seen = readSeen();
      render(items, Boolean(res && res.stale), seen);
      writeSeen(latestId(items)); // se marcan como vistas al abrirlas; la etiqueta «Nueva» de esta visita se queda
    } catch (_) {
      if (alive) showError();
    }
    loading = false;
  }

  load();
  return { el, destroy: () => { alive = false; } };
}
