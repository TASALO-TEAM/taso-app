// Pestaña Perfil (plan Perfil): tarjeta del usuario + tarjeta «Mis avisos» (resumen que lleva a las categorías).
// Arriba a la derecha: recargar y el engranaje de Ajustes. La identidad sale SOLO del initData validado en el servidor (GET /api/me).
// Sin innerHTML ni estilos en línea (CSP).
import { overviewPill } from "../modules/admin.js";
import { ApiError, getAdminOverview, getAlerts, getMe } from "../modules/api.js";
import { h, icon, ICONS } from "../modules/dom.js";
import { avisosSummary, displayName, handleOf, initialOf, profileChips, safePhotoUrl } from "../modules/profile.js";

/** Avatar: la inicial siempre está debajo; la foto (si hay y carga) la tapa. Si la foto falla, se quita y queda la inicial. */
function avatar(user) {
  const box = h("div", { class: "pf-avatar", "aria-hidden": "true" }, h("span", { text: initialOf(user) }));
  const photo = safePhotoUrl(user.photo_url);
  if (photo) {
    const img = h("img", { src: photo, alt: "", referrerpolicy: "no-referrer", decoding: "async", onError: () => img.remove() });
    box.append(img);
  }
  return box;
}

function userCard(user) {
  const handle = handleOf(user);
  return h(
    "div",
    { class: "card pf-card" },
    h(
      "div",
      { class: "pf-head" },
      avatar(user),
      h("div", { class: "pf-id" }, h("p", { class: "pf-name", text: displayName(user) }), handle ? h("p", { class: "sub pf-handle", text: handle }) : null),
    ),
    h("ul", { class: "pf-tags", "aria-label": "Datos de tu cuenta" }, profileChips(user).map((c) => h("li", { class: `pf-tag pf-tag-${c.tone}`, dataset: { chip: c.key }, text: c.text }))),
  );
}

/** Tarjeta de categorías: mismo patrón que las tarjetas de alertas (título, subtítulo, píldora y flecha). */
function avisosCard(summary) {
  return h(
    "button",
    { type: "button", class: "card acard", "aria-label": `Mis avisos. ${summary.text}`, dataset: { go: "avisos" }, onClick: () => { location.hash = "#/avisos"; } },
    h("span", { class: "acard-main" }, h("span", { class: "card-title", text: "Mis avisos" }), h("span", { class: "sub", text: "Precio, imagen, año y frase, Spotlight" })),
    h("span", { class: `pill pill-${summary.tone}`, text: summary.text }),
    icon(...ICONS.chevron),
  );
}

/** Tarjeta solo para admins: lleva al panel de estado y estadísticas. La píldora resume la salud (o invita a abrirlo). */
function adminCard(pill) {
  return h(
    "button",
    { type: "button", class: "card acard", "aria-label": `Estado y estadísticas. ${pill.text}`, dataset: { go: "admin" }, onClick: () => { location.hash = "#/admin"; } },
    h("span", { class: "acard-main" }, h("span", { class: "card-title", text: "Estado y estadísticas" }), h("span", { class: "sub", text: "Salud del sistema, bot y miniapp" })),
    h("span", { class: `pill pill-${pill.tone}`, text: pill.text }),
    icon(...ICONS.chevron),
  );
}

/** Monta la pestaña. ctx = { view, actions, setSubtitle }. Devuelve la función que la desmonta. */
export function mount(ctx) {
  let alive = true;
  let me = null;
  let meError = null; // null | "offline" | "api"
  let alerts = null; // respuesta de /api/alerts, solo para el resumen de la tarjeta
  let overview = null; // solo admins: para la píldora de salud de su tarjeta
  let loading = false;

  const userSlot = h("section", { class: "slot", "aria-label": "Tu perfil" });
  const avisosSlot = h("div", { class: "slot" });
  const adminSlot = h("div", { class: "slot" });
  ctx.view.replaceChildren(userSlot, avisosSlot, adminSlot);
  ctx.setSubtitle("Tu cuenta y tus avisos");

  const refreshBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Actualizar perfil", onClick: () => load() }, icon(...ICONS.refresh));
  const gear = h("a", { class: "icon-btn", href: "#/ajustes", "aria-label": "Ajustes", dataset: { go: "ajustes" } }, icon(...ICONS.settings));
  ctx.actions.replaceChildren(refreshBtn, gear);

  function render() {
    refreshBtn.disabled = loading;
    refreshBtn.classList.toggle("spinning", loading);
    if (me) userSlot.replaceChildren(userCard(me));
    else if (!meError) userSlot.replaceChildren(h("div", { class: "skeleton", "aria-busy": "true" }));
    else {
      userSlot.replaceChildren(
        h(
          "div",
          { class: "card center" },
          h("p", { text: meError === "offline" ? "Sin conexión. No se pudieron cargar tus datos." : "No se pudieron cargar tus datos." }),
          h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => load() }),
        ),
      );
    }
    avisosSlot.replaceChildren(avisosCard(avisosSummary(alerts, Date.now())));
    adminSlot.replaceChildren(...(me && me.is_admin === true ? [adminCard(overviewPill(overview))] : []));
  }

  async function load() {
    if (loading) return;
    loading = true;
    meError = null;
    render();
    // /me y /alerts son independientes: que uno falle no tumba al otro.
    const [meRes, alertsRes] = await Promise.allSettled([getMe(), getAlerts()]);
    if (!alive) return;
    if (meRes.status === "fulfilled" && meRes.value && meRes.value.user) {
      me = meRes.value.user;
    } else if (!me) {
      meError = meRes.status === "rejected" && meRes.reason instanceof ApiError && meRes.reason.status === 0 ? "offline" : "api";
    }
    if (alertsRes.status === "fulfilled") alerts = alertsRes.value;
    loading = false;
    render();
    // Solo admins: la píldora de salud llega aparte (puede tardar o fallar) y nunca retrasa el resto del perfil.
    if (me && me.is_admin === true) {
      try {
        const ov = await getAdminOverview("24h");
        if (!alive) return;
        overview = ov;
        render();
      } catch (_) {
        /* la tarjeta queda con «Ver estado» */
      }
    }
  }

  render();
  load();

  return () => {
    alive = false;
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
