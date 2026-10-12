// Pestaña Perfil (plan Perfil, P2): datos del usuario que entra y, debajo, «Mis avisos» (los paneles de alertas de S6).
// La identidad sale SOLO del initData validado en el servidor (GET /api/me); aquí no se manda ni se lee un uid.
// Sin innerHTML ni estilos en línea (CSP). «Mis avisos» reutiliza views/alertas.js tal cual: mismo código, otro contenedor.
import { ApiError, getMe } from "../modules/api.js";
import { h } from "../modules/dom.js";
import { displayName, handleOf, initialOf, profileChips, safePhotoUrl } from "../modules/profile.js";
import * as avisos from "./alertas.js";

/** Avatar: la inicial siempre está debajo; la foto (si hay y carga) la tapa. Si la foto falla, se quita y queda la inicial. */
function avatar(user) {
  const box = h("div", { class: "pf-avatar", "aria-hidden": "true" }, h("span", { text: initialOf(user) }));
  const photo = safePhotoUrl(user.photo_url);
  if (photo) {
    const img = h("img", {
      src: photo, alt: "", referrerpolicy: "no-referrer", decoding: "async",
      onError: () => img.remove(),
    });
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

/** Monta la pestaña. ctx = { view, actions, setSubtitle }. Devuelve la función que la desmonta. */
export function mount(ctx) {
  let alive = true;
  let me = null;
  let meError = null; // null | "offline" | "api"

  const userSlot = h("section", { class: "slot", "aria-label": "Tu perfil" });
  const avisosSlot = h("div", { class: "pf-avisos" });
  ctx.view.replaceChildren(
    userSlot,
    h("h2", { class: "pf-h", text: "Mis avisos" }),
    avisosSlot,
  );
  ctx.setSubtitle("Tu cuenta y tus avisos");

  function renderUser() {
    if (me) {
      userSlot.replaceChildren(userCard(me));
      return;
    }
    if (!meError) {
      userSlot.replaceChildren(h("div", { class: "skeleton", "aria-busy": "true" }));
      return;
    }
    userSlot.replaceChildren(
      h(
        "div",
        { class: "card center" },
        h("p", { text: meError === "offline" ? "Sin conexión. No se pudieron cargar tus datos." : "No se pudieron cargar tus datos." }),
        h("button", { type: "button", class: "btn", text: "Reintentar", onClick: loadMe }),
      ),
    );
  }

  async function loadMe() {
    meError = null;
    renderUser();
    try {
      const res = await getMe();
      if (!alive) return;
      me = res.user;
    } catch (e) {
      if (!alive) return;
      meError = e instanceof ApiError && e.status === 0 ? "offline" : "api";
    }
    renderUser();
  }

  // «Mis avisos»: la pestaña de alertas montada dentro de este contenedor. Su botón de actualizar ocupa `actions`.
  const stopAvisos = avisos.mount({ view: avisosSlot, actions: ctx.actions, setSubtitle: () => {} });
  renderUser();
  loadMe();

  return () => {
    alive = false;
    stopAvisos();
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
