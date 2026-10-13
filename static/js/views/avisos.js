// Sub-pantalla «Mis avisos» (plan Perfil): las categorías de alertas de S6 (precio, imagen, año y frase, Spotlight).
// Perfil solo muestra una tarjeta resumen que lleva aquí; el código de las alertas es el mismo de siempre (views/alertas.js).
import { h } from "../modules/dom.js";
import * as alertas from "./alertas.js";
import { backToPerfil } from "./subnav.js";

export function mount(ctx) {
  const body = h("div", { class: "pf-avisos" });
  ctx.view.replaceChildren(backToPerfil(), body);
  const stop = alertas.mount({ view: body, actions: ctx.actions, setSubtitle: ctx.setSubtitle });
  return () => stop();
}
