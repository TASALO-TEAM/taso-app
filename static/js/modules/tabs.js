// Rutas de pestañas (sin DOM): alias de enlaces antiguos para que nada de lo ya enviado por el bot se rompa.
// Alertas pasó a ser Perfil (plan Perfil, P2): `#/alertas` y `?startapp=tab_alertas` siguen abriendo la misma pantalla.

export const TAB_ALIASES = Object.freeze({ alertas: "perfil" });

/** Nombre de pestaña conocido para `name` (resolviendo alias), o null si no existe. `tabs` = objeto clave → título. */
export function resolveTab(name, tabs) {
  if (typeof name !== "string") return null;
  const key = Object.hasOwn(TAB_ALIASES, name) ? TAB_ALIASES[name] : name;
  return Object.hasOwn(tabs, key) ? key : null;
}
