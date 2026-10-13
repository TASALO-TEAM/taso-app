// Arranque de la miniapp: identidad, estados globales y navegación por pestañas.
import * as sdk from "./modules/sdk.js";
import { getMe, ApiError } from "./modules/api.js";
import { syncFromCloud } from "./modules/settings.js";
import { resolveRoute } from "./modules/tabs.js";

const $ = (id) => document.getElementById(id);

const TABS = {
  tasas: "Tasas",
  mercado: "Mercado",
  calculadora: "Calculadora",
  blog: "Blog",
  perfil: "Perfil",
};
const DEFAULT_TAB = "tasas";

const SCREENS = ["state-loading", "state-unidentified", "state-error", "shell"];

function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

/** Ruta actual: { name, tab (la resaltada en la barra), title }. Las sub-pantallas (avisos, ajustes) cuelgan de Perfil. */
function currentRoute() {
  const m = location.hash.match(/^#\/([a-z]+)/);
  return (m && resolveRoute(m[1], TABS)) || resolveRoute(DEFAULT_TAB, TABS);
}

/** Enlace profundo desde el bot: ?startapp=tab_perfil → #/perfil (solo pestañas conocidas; tab_alertas sigue valiendo). */
function applyStartParam() {
  if (location.hash) return;
  const m = sdk.startParam().match(/^tab_([a-z]+)$/);
  const target = m && resolveRoute(m[1], TABS);
  if (target) location.hash = `#/${target.name}`;
}

function renderPlaceholder(label) {
  const view = $("view");
  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("p");
  title.className = "card-title";
  title.textContent = label;
  const text = document.createElement("p");
  text.className = "sub";
  text.textContent = "Esta sección llega en la siguiente entrega.";
  card.append(title, text);
  view.replaceChildren(card);
}

// Vistas ya construidas; las demás pestañas muestran el marcador hasta su sección.
const VIEWS = {
  tasas: () => import("./views/tasas.js"),
  mercado: () => import("./views/mercado.js"),
  calculadora: () => import("./views/calculadora.js"),
  blog: () => import("./views/blog.js"),
  perfil: () => import("./views/perfil.js"),
  avisos: () => import("./views/avisos.js"),
  ajustes: () => import("./views/ajustes.js"),
  admin: () => import("./views/admin.js"),
};

let unmountCurrent = null;
let routeToken = 0;

async function route() {
  const cur = currentRoute();
  const tab = cur.tab;
  for (const link of document.querySelectorAll(".nv")) {
    if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("view-title").textContent = cur.title;
  $("view-subtitle").textContent = "";
  document.title = `TASALO · ${cur.title}`;

  const token = ++routeToken;
  if (unmountCurrent) {
    unmountCurrent();
    unmountCurrent = null;
  }
  const loader = VIEWS[cur.name];
  if (!loader) {
    $("view-actions").replaceChildren();
    renderPlaceholder(cur.title);
    return;
  }
  try {
    const mod = await loader();
    if (token !== routeToken) return; // el usuario ya cambió de pestaña
    unmountCurrent = mod.mount({
      view: $("view"),
      actions: $("view-actions"),
      setSubtitle: (text) => {
        $("view-subtitle").textContent = text;
      },
    });
  } catch (_) {
    if (token === routeToken) renderPlaceholder(cur.title);
  }
}

function showError(message) {
  $("error-text").textContent = message;
  showScreen("state-error");
}

async function load() {
  if (!sdk.hasIdentity()) {
    showScreen("state-unidentified");
    return;
  }
  showScreen("state-loading");
  try {
    await getMe();
    applyStartParam();
    showScreen("shell");
    route();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) showScreen("state-unidentified");
    else if (e instanceof ApiError && e.status === 0) showError("No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.");
    else showError("Algo falló al cargar. Inténtalo de nuevo en un momento.");
  }
}

function updateOnline() {
  $("banner-offline").hidden = navigator.onLine !== false;
}

sdk.init();
syncFromCloud().then((changed) => {
  if (changed) sdk.applyTheme(); // la nube trajo otro tema/convención
});
window.addEventListener("hashchange", () => {
  if (!$("shell").hidden) route();
});
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
$("retry").addEventListener("click", load);
updateOnline();
load();
