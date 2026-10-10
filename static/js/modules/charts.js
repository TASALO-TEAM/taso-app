// Gráficos SVG propios (sin librerías ni estilos en línea por la CSP): sparkline de tarjeta y línea con cursor.
// Toda la matemática (posiciones, escalas) vive en history-math.js; aquí solo se dibuja.
import { chartGeometry, nearestIndex, trendOf } from "./history-math.js";

const NS = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

const SPARK = { width: 100, height: 28, padX: 2, padTop: 3, padBottom: 3 };

/** Sparkline decorativo (aria-hidden: la variación ya está escrita en la tarjeta). null si no hay al menos 2 puntos. */
export function sparkline(points) {
  const g = chartGeometry(points, SPARK);
  if (!g || g.single) return null;
  const svg = s("svg", {
    viewBox: `0 0 ${SPARK.width} ${SPARK.height}`,
    class: `spark spark-${trendOf(points)}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(s("path", { class: "spark-line", d: g.line }));
  return svg;
}

const CHART = { width: 340, height: 150, padX: 8, padTop: 12, padBottom: 12 };

/**
 * Gráfico de línea con área y cursor (tacto o ratón). `onReadout({date, rate})` se llama al mover el cursor y con
 * null cuando se suelta (el que llama decide qué texto mostrar fuera del SVG). Devuelve el <svg>.
 */
export function lineChart(points, { label, onReadout = () => {} }) {
  const g = chartGeometry(points, CHART);
  const svg = s("svg", { viewBox: `0 0 ${CHART.width} ${CHART.height}`, class: "chart", role: "img", "aria-label": label });
  if (!g) return svg;

  if (g.area) svg.append(s("path", { class: "ch-area", d: g.area }));
  if (!g.single) svg.append(s("path", { class: "ch-line", d: g.line }));
  const last = g.coords[g.coords.length - 1];
  const cursor = s("line", { class: "ch-cursor", x1: last.x, x2: last.x, y1: 0, y2: CHART.height });
  const dot = s("circle", { class: "ch-dot", cx: last.x, cy: last.y, r: 4.5 });
  svg.append(cursor, dot);

  function select(i) {
    const c = g.coords[i];
    cursor.setAttribute("x1", c.x);
    cursor.setAttribute("x2", c.x);
    dot.setAttribute("cx", c.x);
    dot.setAttribute("cy", c.y);
    cursor.classList.add("on");
    onReadout({ date: c.date, rate: c.rate });
  }

  function reset() {
    cursor.classList.remove("on");
    cursor.setAttribute("x1", last.x);
    cursor.setAttribute("x2", last.x);
    dot.setAttribute("cx", last.x);
    dot.setAttribute("cy", last.y);
    onReadout(null);
  }

  function at(ev) {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const i = nearestIndex(g.coords, ((ev.clientX - box.left) / box.width) * CHART.width);
    if (i >= 0) select(i);
  }

  svg.addEventListener("pointerdown", at);
  svg.addEventListener("pointermove", at);
  svg.addEventListener("pointerleave", reset);
  svg.addEventListener("pointercancel", reset);
  svg.addEventListener("pointerup", (ev) => {
    if (ev.pointerType !== "mouse") reset();
  });
  return svg;
}
