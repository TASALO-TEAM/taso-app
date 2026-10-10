// Comparación de versiones del SDK de Telegram (p. ej. "9.1" >= "6.1"). Módulo puro, sin DOM.

/** Convierte "7.10" en [7, 10]; partes no numéricas cuentan como 0. */
export function parseVersion(value) {
  return String(value ?? "")
    .split(".")
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

/** -1, 0 o 1 según a < b, a = b, a > b. "7.10" > "7.9" (compara por números, no por texto). */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** ¿La versión actual cumple la mínima? Si no hay versión actual, no. */
export function isVersionAtLeast(current, minimum) {
  if (!current) return false;
  return compareVersions(current, minimum) >= 0;
}
