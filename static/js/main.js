// Arranque de la miniapp: identidad, estados globales y navegación por pestañas.
import * as sdk from "./modules/sdk.js";
import { getMe, ApiError } from "./modules/api.js";

const $ = (id) => document.getElementById(id);

const TABS = {
  tasas: "Tasas",
  combustible: "Combustible",
  calculadora: "Calculadora",
  blog: "Blog",
  alertas: "Alertas",
};
const DEFAULT_TAB = "tasas";

const SCREENS = ["state-loading", "state-unidentified", "state-error", "shell"];

function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

function currentTab() {
  const m = location.hash.match(/^#\/([a-z]+)/);
  return m && Object.hasOwn(TABS, m[1]) ? m[1] : DEFAULT_TAB;
}

/** Enlace profundo desde el bot: ?startapp=tab_alertas → #/alertas (solo pestañas conocidas). */
function applyStartParam() {
  if (location.hash) return;
  const m = sdk.startParam().match(/^tab_([a-z]+)$/);
  if (m && Object.hasOwn(TABS, m[1])) location.hash = `#/${m[1]}`;
}

function renderPlaceholder(tab) {
  const view = $("view");
  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("p");
  title.className = "card-title";
  title.textContent = TABS[tab];
  const text = document.createElement("p");
  text.className = "sub";
  text.textContent = "Esta sección llega en la siguiente entrega.";
  card.append(title, text);
  view.replaceChildren(card);
}

// Vistas ya construidas; las demás pestañas muestran el marcador hasta su sección.
const VIEWS = {
  tasas: () => import("./views/tasas.js"),
  combustible: () => import("./views/combustible.js"),
  calculadora: () => import("./views/calculadora.js"),
  blog: () => import("./views/blog.js"),
  alertas: () => import("./views/alertas.js"),
};

let unmountCurrent = null;
let routeToken = 0;

async function route() {
  const tab = currentTab();
  for (const link of document.querySelectorAll(".nv")) {
    if (link.dataset.tab === tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("view-title").textContent = TABS[tab];
  $("view-subtitle").textContent = "";
  document.title = `TASALO · ${TABS[tab]}`;

  const token = ++routeToken;
  if (unmountCurrent) {
    unmountCurrent();
    unmountCurrent = null;
  }
  const loader = VIEWS[tab];
  if (!loader) {
    $("view-actions").replaceChildren();
    renderPlaceholder(tab);
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
    if (token === routeToken) renderPlaceholder(tab);
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
window.addEventListener("hashchange", () => {
  if (!$("shell").hidden) route();
});
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
$("retry").addEventListener("click", load);
updateOnline();
load();
