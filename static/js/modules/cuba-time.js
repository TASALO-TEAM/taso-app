// Hora de Cuba (America/Havana) sin librerías. Cuba cambia entre UTC−5 y UTC−4: nunca se usa un offset fijo.

const FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Havana",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Milisegundos desde ISO (string), Date o número. Inválido → null. */
export function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? null : ms;
}

/** Partes de la fecha/hora en Cuba para un instante: {year, month, day, hour, minute, second}. */
export function cubaParts(ms) {
  const parts = {};
  for (const p of FORMATTER.formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number.parseInt(p.value, 10);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Algunos motores devuelven 24 a medianoche con h23; se normaliza.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

const pad = (n, width = 2) => String(n).padStart(width, "0");

/** «2026-10-10» (fecha en Cuba), útil como clave de «hoy». */
export function cubaDateKey(ms) {
  const p = cubaParts(ms);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** «10/10/2026» (dd/MM/yyyy en Cuba). */
export function cubaDateText(ms) {
  const p = cubaParts(ms);
  return `${pad(p.day)}/${pad(p.month)}/${pad(p.year, 4)}`;
}
