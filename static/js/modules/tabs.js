// Rutas de la miniapp (sin DOM). Hay pestañas (barra inferior) y sub-pantallas que cuelgan de una pestaña.
// También aquí viven los alias de enlaces antiguos para que nada de lo ya enviado por el bot se rompa:
// Alertas pasó a ser Perfil (plan Perfil, P2), así que `#/alertas` y `?startapp=tab_alertas` abren Perfil.

export const TAB_ALIASES = Object.freeze({ alertas: "perfil" });

/** Sub-pantallas: no están en la barra; la pestaña `parent` queda resaltada mientras se ven. */
export const SUBROUTES = Object.freeze({
  avisos: Object.freeze({ title: "Mis avisos", parent: "perfil" }),
  ajustes: Object.freeze({ title: "Ajustes", parent: "perfil" }),
  admin: Object.freeze({ title: "Estado y estadísticas", parent: "perfil" }),
});

/** Nombre de pestaña conocido para `name` (resolviendo alias), o null si no existe. `tabs` = objeto clave → título. */
export function resolveTab(name, tabs) {
  if (typeof name !== "string") return null;
  const key = Object.hasOwn(TAB_ALIASES, name) ? TAB_ALIASES[name] : name;
  return Object.hasOwn(tabs, key) ? key : null;
}

/** Ruta completa: { name, tab (la que se resalta en la barra), title } o null si no existe ni como pestaña ni como sub-pantalla. */
export function resolveRoute(name, tabs, subroutes = SUBROUTES) {
  const tab = resolveTab(name, tabs);
  if (tab) return { name: tab, tab, title: tabs[tab] };
  if (typeof name === "string" && Object.hasOwn(subroutes, name)) {
    const sub = subroutes[name];
    return Object.hasOwn(tabs, sub.parent) ? { name, tab: sub.parent, title: sub.title } : null;
  }
  return null;
}
