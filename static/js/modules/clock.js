// Reloj corregido con la hora del servidor. El reloj del dispositivo puede ir adelantado o atrasado (zona mal puesta,
// hora a mano): "hace 1 h" en un dato recien traido. Cada respuesta de la API trae la cabecera `Date`; de ahi sale el
// desfase. Sin ninguna respuesta todavia, el desfase es 0 (reloj del dispositivo). Modulo puro salvo `Date.now`.

let skewMs = 0;

/** Aprende el desfase (servidor - dispositivo) de una cabecera `Date`. Ignora lo que no sea una fecha valida. */
export function learnSkew(dateHeader, deviceNow = Date.now()) {
  const server = Date.parse(String(dateHeader || ""));
  if (Number.isNaN(server)) return;
  skewMs = server - deviceNow;
}

/** Ahora, en milisegundos, segun el servidor. */
export function serverNow() {
  return Date.now() + skewMs;
}

/** Desfase actual (ms); solo para pruebas y diagnostico. */
export function getSkew() {
  return skewMs;
}

export function resetSkew() {
  skewMs = 0;
}
