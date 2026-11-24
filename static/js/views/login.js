// Pestañas privadas (Perfil, Mis avisos, Mis estadísticas, Estado) para quien abre la web sin sesión: tarjeta de «Entrar con Telegram».
// El botón es un enlace normal: el servidor arma el flujo (state + PKCE), manda a Telegram y vuelve aquí con la cookie de sesión.
// Sin innerHTML ni estilos en línea (CSP).
import { BOT, LOGIN_ENABLED, LOGIN_URL } from "../modules/api.js";
import { h, icon, ICONS } from "../modules/dom.js";
import { loginNote } from "../modules/session.js";

/** Monta la tarjeta. ctx = { view, actions, setSubtitle }. Devuelve la función que la desmonta. */
export function mount(ctx) {
  const note = loginNote(location.search);
  // El servidor vuelve con ?login=error|busy|off: el aviso se enseña una vez y se limpia la URL (un F5 no lo repite).
  if (note) history.replaceState(null, "", location.pathname + location.hash);

  ctx.setSubtitle("Entra para ver tu cuenta");
  ctx.actions.replaceChildren(h("a", { class: "icon-btn", href: "#/ajustes", "aria-label": "Ajustes", dataset: { go: "ajustes" } }, icon(...ICONS.settings)));

  ctx.view.replaceChildren(
    note ? h("div", { class: "notice", role: "alert", text: note }) : null,
    h(
      "section",
      { class: "card center", "aria-label": "Iniciar sesión" },
      h("p", { class: "card-title", text: "Entra con tu cuenta de Telegram" }),
      h("p", { class: "sub", text: "Para ver tu perfil, tus avisos y tus estadísticas. Tasas, Mercado, Calculadora y Blog se ven sin entrar." }),
      LOGIN_ENABLED ? h("a", { class: "btn block", href: LOGIN_URL, dataset: { go: "login" }, text: "Entrar con Telegram" }) : null,
      BOT ? h("a", { class: "btn btn-ghost block", href: `https://t.me/${BOT}`, rel: "noopener noreferrer", text: LOGIN_ENABLED ? "Abrir en Telegram" : `Abrir @${BOT}` }) : null,
    ),
  );

  return () => {
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
