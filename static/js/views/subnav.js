// Botón «‹ Perfil» de las sub-pantallas (Mis avisos, Ajustes). Siempre visible dentro de la pantalla: no depende del botón Atrás
// de Telegram, porque los paneles de alertas lo usan y lo ocultan al cerrarse.
import { h, icon, ICONS } from "../modules/dom.js";

export function backToPerfil() {
  return h(
    "button",
    { type: "button", class: "btn-ghost mk-back sub-back", onClick: () => { location.hash = "#/perfil"; } },
    icon(...ICONS.back),
    h("span", { text: "Perfil" }),
  );
}
