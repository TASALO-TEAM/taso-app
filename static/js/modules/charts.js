// Gráficos SVG propios (sin librerías ni estilos en línea por la CSP): sparkline de tarjeta y línea con cursor.
// Toda la matemática (posiciones, escalas) vive en history-math.js; aquí solo se dibuja.
import { chartGeometry, nearestIndex, trendOf } from "./history-math.js";
import { axisPrice, axisTime, rangeChange, seriesGeometry } from "./market.js";

const NS = "http://www.w3.org/2000/svg";

function s(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

const SPARK = { width: 100, height: 28, padX: 4, padTop: 5, padBottom: 2 };
let sparkSeq = 0; // id único del degradado de cada sparkline (varios SVG conviven en la misma página)

/**
 * Sparkline decorativo de la tarjeta (aria-hidden: la variación ya está escrita en ella). Mismo lenguaje visual que la
 * gráfica del detalle y la de Mercado: línea, área con degradado hacia transparente y punto en el último valor.
 * El punto es un tramo de largo cero con borde redondo y `vector-effect: non-scaling-stroke`, así sigue siendo un
 * círculo aunque el SVG se estire (preserveAspectRatio="none"). null si no hay al menos 2 puntos.
 */
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
  sparkSeq += 1;
  const gradId = `spark-g${sparkSeq}`;
  const grad = s("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(s("stop", { class: "spark-stop-top", offset: "0" }), s("stop", { class: "spark-stop-bot", offset: "1" }));
  const defs = s("defs");
  defs.append(grad);
  const last = g.coords[g.coords.length - 1];
  svg.append(
    defs,
    s("path", { class: "spark-area", d: g.area, fill: `url(#${gradId})` }),
    s("path", { class: "spark-line", d: g.line }),
    s("path", { class: "spark-dot", d: `M${last.x} ${last.y}h0.01` }),
  );
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

// ---------- Mercado (S10 F4): minigráfica de la tira de monedas y gráfica de precio con ejes ----------
// La matemática (X por tiempo, Y de mínimo a máximo, marcas de ejes) vive en market.js; aquí solo se dibuja.
const TICK_SPARK = { width: 60, height: 22, padLeft: 1, padRight: 1, padTop: 2, padBottom: 2 };
const PRICE_BASE = { width: 340, height: 190, padLeft: 46, padRight: 8, padTop: 10, padBottom: 22 };
const FIT_MIN = 300;
const FIT_MAX = 640;

/**
 * Medidas de la gráfica para un ancho dado (unidades del viewBox = píxeles CSS). Con 340 es la de siempre; en pantallas
 * anchas crece ancho y alto, así las etiquetas de los ejes se quedan de tamaño normal en vez de agrandarse con el SVG.
 */
export function priceDims(width = PRICE_BASE.width) {
  const w = Number.isFinite(width) ? Math.round(Math.min(FIT_MAX, Math.max(FIT_MIN, width))) : PRICE_BASE.width;
  return { ...PRICE_BASE, width: w, height: Math.round(PRICE_BASE.height + Math.max(0, w - PRICE_BASE.width) * 0.35) };
}

/**
 * Ancho útil del SVG dentro de `el` (restando `inset`, el relleno horizontal de `el`). Si `el` aún no está en la página
 * no se puede medir y se estima con la ventana; en móvil (≤ 480 px) devuelve el ancho de siempre.
 */
export function fitWidth(el, inset = 0) {
  const measured = el && el.isConnected ? el.clientWidth - inset : 0;
  if (measured > 0) return measured;
  const win = typeof window === "undefined" ? 0 : window.innerWidth;
  return win > 480 ? win - 96 : PRICE_BASE.width;
}

const trendKind = (series) => {
  const change = rangeChange(series);
  return change ? change.kind : "neutral";
};

/** Minigráfica de una moneda (decorativa: la variación ya está escrita en su botón). null con menos de 2 puntos. */
export function seriesSparkline(series) {
  const g = seriesGeometry(series, TICK_SPARK);
  if (!g) return null;
  const svg = s("svg", {
    viewBox: `0 0 ${TICK_SPARK.width} ${TICK_SPARK.height}`,
    class: `spark spark-${trendKind(series)}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(s("path", { class: "spark-line", d: g.line }));
  return svg;
}

/**
 * Gráfica de precio con cuadrícula, etiquetas de eje, línea base (precio al inicio del rango) y cursor táctil.
 * `onReadout({time, value})` se llama al mover el cursor y con null al soltarlo; el texto se muestra fuera del SVG.
 * Color por tendencia con la variable --trend (la fija la clase pc-up / pc-down / pc-neutral). Devuelve el <svg>.
 * `width` (opcional, ver fitWidth) ajusta las medidas al ancho real de la pantalla; sin él, 340 como siempre.
 */
export function priceChart(series, { label, rangeId, width, onReadout = () => {} }) {
  const PRICE = priceDims(width);
  const g = seriesGeometry(series, PRICE);
  const svg = s("svg", { viewBox: `0 0 ${PRICE.width} ${PRICE.height}`, class: `chart pc pc-${trendKind(series)}`, role: "img", "aria-label": label });
  if (!g) return svg;
  const left = PRICE.padLeft;
  const right = PRICE.width - PRICE.padRight;
  const floor = PRICE.height - PRICE.padBottom;
  const label2 = (x, y, anchor, value) => {
    const el = s("text", { class: "pc-lab", x, y, "text-anchor": anchor });
    el.textContent = value;
    return el;
  };

  for (const t of g.yTicks) svg.append(s("line", { class: "pc-grid", x1: left, x2: right, y1: t.y, y2: t.y }), label2(left - 6, t.y + 3.5, "end", axisPrice(t.value)));
  for (const t of g.xTicks) svg.append(s("line", { class: "pc-grid", x1: t.x, x2: t.x, y1: PRICE.padTop, y2: floor }), label2(t.x, PRICE.height - 6, "middle", axisTime(t.time, rangeId)));
  svg.append(
    s("path", { class: "pc-area", d: g.area }),
    s("path", { class: "pc-line", d: g.line }),
    s("line", { class: "pc-base", x1: left, x2: right, y1: g.base.y, y2: g.base.y }),
  );

  const last = g.coords[g.coords.length - 1];
  const cursor = s("line", { class: "pc-cursor", x1: last.x, x2: last.x, y1: PRICE.padTop, y2: floor });
  const dot = s("circle", { class: "pc-dot", cx: last.x, cy: last.y, r: 4.5 });
  svg.append(cursor, dot);

  function select(i) {
    const c = g.coords[i];
    cursor.setAttribute("x1", c.x);
    cursor.setAttribute("x2", c.x);
    dot.setAttribute("cx", c.x);
    dot.setAttribute("cy", c.y);
    cursor.classList.add("on");
    onReadout({ time: c.time, value: c.value });
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
    const i = nearestIndex(g.coords, ((ev.clientX - box.left) / box.width) * PRICE.width);
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
