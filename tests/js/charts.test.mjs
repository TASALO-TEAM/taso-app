import test from "node:test";
import assert from "node:assert/strict";
import { fitWidth, priceDims } from "../../static/js/modules/charts.js";
import { cubaDateKey } from "../../static/js/modules/cuba-time.js";
import { pointsToSeries } from "../../static/js/modules/history-math.js";
import { cleanSeries, seriesGeometry } from "../../static/js/modules/market.js";

const P = (date, rate) => ({ date, rate });

test("pointsToSeries: un par [ms, precio] por día, en orden, y cada día sigue siendo ese día en Cuba", () => {
  const series = pointsToSeries([P("2026-11-15", 810), P("2026-11-14", 805.68), P("2026-11-16", null), P("mal", 5)]);
  assert.equal(series.length, 2);
  assert.deepEqual(series.map((p) => p[1]), [805.68, 810]);
  assert.deepEqual(series.map((p) => cubaDateKey(p[0])), ["2026-11-14", "2026-11-15"]);
  assert.equal(series[1][0] - series[0][0], 86400000);
  assert.deepEqual(pointsToSeries([]), []);
});

test("pointsToSeries: lo que sale lo acepta la geometría de la gráfica de Mercado", () => {
  const series = pointsToSeries([P("2026-11-14", 805.68), P("2026-11-15", 810), P("2026-11-16", 800)]);
  assert.equal(cleanSeries(series).length, 3);
  const g = seriesGeometry(series, priceDims(340));
  assert.equal(g.coords.length, 3);
  assert.equal(pointsToSeries([P("2026-11-14", 805.68)]).length, 1); // un solo día: el que dibuja decide usar otra gráfica
});

test("priceDims: 340 es la medida de siempre; en pantallas anchas crece con tope", () => {
  assert.deepEqual([priceDims().width, priceDims().height], [340, 190]);
  assert.equal(priceDims(100).width, 300);
  assert.equal(priceDims(2000).width, 640);
  assert.equal(priceDims(2000).height, 295);
  assert.equal(priceDims(NaN).width, 340);
  assert.ok(priceDims(600).height > priceDims(340).height);
});

test("fitWidth: sin elemento ni ventana devuelve el ancho de siempre; con elemento medido, su ancho útil", () => {
  assert.equal(fitWidth(null), 340);
  assert.equal(fitWidth({ isConnected: true, clientWidth: 600 }, 16), 584);
  assert.equal(fitWidth({ isConnected: false, clientWidth: 600 }, 16), 340);
});
