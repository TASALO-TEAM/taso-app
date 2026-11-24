// Quién usa la app ahora y qué pestañas piden iniciar sesión. Sin DOM. Lo llena main.js con GET /api/me.
// La identidad real la decide siempre el servidor (initData o cookie); esto solo ordena la interfaz.

/** Rutas que muestran datos de la cuenta: sin sesión se ve la tarjeta de «Entrar con Telegram». Lo demás es público. */
const PRIVATE_ROUTES = new Set(["perfil", "avisos", "estadisticas", "admin"]);

const NOBODY = Object.freeze({ user: null, via: null });
let current = NOBODY;

/** `me` = respuesta de /api/me ({ user, via }); cualquier otra cosa deja a la persona como visitante. */
export function setSession(me) {
  current = me && me.user ? Object.freeze({ user: me.user, via: me.via === "web" ? "web" : "telegram" }) : NOBODY;
}

export const session = () => current;
export const isSignedIn = () => current.user !== null;
export const needsLogin = (routeName, signedIn = isSignedIn()) => !signedIn && PRIVATE_ROUTES.has(routeName);

const LOGIN_NOTES = Object.freeze({
  error: "No se pudo iniciar sesión con Telegram. Inténtalo de nuevo.",
  busy: "Hay demasiados intentos ahora mismo. Espera un minuto e inténtalo otra vez.",
  off: "El acceso desde el navegador no está disponible por ahora. Abre TASALO desde Telegram.",
});

/** Aviso para el parámetro ``?login=`` con el que el servidor vuelve del flujo de Telegram; null si no hay o no se conoce. */
export function loginNote(search) {
  const value = new URLSearchParams(search || "").get("login");
  return value !== null && Object.hasOwn(LOGIN_NOTES, value) ? LOGIN_NOTES[value] : null;
}
