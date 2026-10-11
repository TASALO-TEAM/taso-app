import assert from "node:assert/strict";
import test from "node:test";

import {
  cubaHourToUtc, cubaOffsetHours, dstChangeSoon, errorMessage, fmtPrice, hourLabel, imageStatus, priceLine, priceStatus,
  spotlightStatus, utcHourToCuba, yearStatus,
} from "../../static/js/modules/alerts.js";

const t = (iso) => Date.parse(iso);
const OCT = t("2026-10-10T16:00:00Z"); // horario de verano: UTC-4
const NOV = t("2026-11-10T16:00:00Z"); // ya sin verano: UTC-5

test("desfase de Cuba: -4 en verano y -5 en invierno, sin depender de la zona del teléfono", () => {
  assert.equal(cubaOffsetHours(OCT), -4);
  assert.equal(cubaOffsetHours(NOV), -5);
  assert.equal(cubaOffsetHours(t("2026-01-15T12:00:00Z")), -5);
  assert.equal(cubaOffsetHours(t("2026-07-01T12:00:00Z")), -4);
});

test("el cambio de horario mueve la conversión una hora (D7)", () => {
  // 7:00 en Cuba: 11 UTC en octubre, 12 UTC en noviembre
  assert.equal(cubaHourToUtc(7, OCT), 11);
  assert.equal(cubaHourToUtc(7, NOV), 12);
  // lo guardado (11 UTC) se ve como 7:00 antes del cambio y 6:00 después
  assert.equal(utcHourToCuba(11, OCT), 7);
  assert.equal(utcHourToCuba(11, NOV), 6);
});

test("la conversión da la vuelta al día", () => {
  assert.equal(cubaHourToUtc(22, OCT), 2);
  assert.equal(utcHourToCuba(2, OCT), 22);
  assert.equal(cubaHourToUtc(0, NOV), 5);
  assert.equal(utcHourToCuba(3, NOV), 22);
});

test("ida y vuelta para las 24 horas, en verano y en invierno", () => {
  for (const now of [OCT, NOV]) {
    for (let h = 0; h < 24; h++) assert.equal(utcHourToCuba(cubaHourToUtc(h, now), now), h);
  }
});

test("dstChangeSoon avisa solo cuando el cambio cae dentro de la ventana", () => {
  assert.equal(dstChangeSoon(OCT), true); // el 1 nov
  assert.equal(dstChangeSoon(t("2026-08-01T12:00:00Z")), false);
  assert.equal(dstChangeSoon(t("2026-01-15T12:00:00Z")), false);
  assert.equal(dstChangeSoon(t("2026-02-20T12:00:00Z")), true); // marzo
});

test("hourLabel", () => {
  assert.equal(hourLabel(7), "07:00");
  assert.equal(hourLabel(19), "19:00");
});

test("estados del resumen", () => {
  assert.deepEqual(priceStatus({ ok: true, items: [] }), { text: "Sin alertas", tone: "off" });
  assert.deepEqual(priceStatus({ ok: true, items: [{}] }), { text: "1 activa", tone: "on" });
  assert.deepEqual(priceStatus({ ok: true, items: [{}, {}] }), { text: "2 activas", tone: "on" });
  assert.deepEqual(priceStatus({ ok: false }), { text: "No disponible", tone: "warn" });
  assert.deepEqual(priceStatus(undefined), { text: "No disponible", tone: "warn" });

  assert.deepEqual(imageStatus({ ok: true, config: null }), { text: "Sin configurar", tone: "off" });
  assert.deepEqual(imageStatus({ ok: true, config: { alert_time: "07:30", enabled: true } }), { text: "Activa · 07:30", tone: "on" });
  assert.deepEqual(imageStatus({ ok: true, config: { alert_time: "07:30", enabled: false } }), { text: "Pausada · 07:30", tone: "off" });

  assert.deepEqual(yearStatus({ ok: true, hour: null }, OCT), { text: "Sin configurar", tone: "off" });
  assert.deepEqual(yearStatus({ ok: true, hour: 11 }, OCT), { text: "Activa · 07:00", tone: "on" });
  assert.deepEqual(yearStatus({ ok: true, hour: 11 }, NOV), { text: "Activa · 06:00", tone: "on" });

  assert.deepEqual(spotlightStatus({ ok: true, hours: [] }, OCT), { text: "Sin configurar", tone: "off" });
  assert.deepEqual(spotlightStatus({ ok: true, hours: [23, 11] }, OCT), { text: "Activa · 07:00, 19:00", tone: "on" });
  assert.deepEqual(spotlightStatus({ ok: true, hours: [3, 17] }, OCT), { text: "Activa · 13:00, 23:00", tone: "on" });
});

test("priceLine", () => {
  const f = (v) => String(v).replace(".", ",");
  assert.equal(priceLine({ condition: "ABOVE", target_price: 70000, price_at_creation: 65000.5 }, f), "Sube a 70000 · al crear: 65000,5");
  assert.equal(priceLine({ condition: "BELOW", target_price: 60000, price_at_creation: null }, f), "Baja a 60000");
});

test("fmtPrice: decimales según el tamaño del precio, sin ceros sobrantes ni notación científica", () => {
  assert.equal(fmtPrice(70000), "70000");
  assert.equal(fmtPrice(65000.5), "65000,5");
  assert.equal(fmtPrice(1234.567), "1234,57");
  assert.equal(fmtPrice(0.5), "0,5");
  assert.equal(fmtPrice(0.0123), "0,0123");
  assert.equal(fmtPrice(0.00001234), "0,00001234");
  assert.equal(fmtPrice(1e-7), "0,0000001");
  assert.equal(fmtPrice(0), "0");
  assert.equal(fmtPrice(null), "—");
  assert.equal(fmtPrice(Number.NaN), "—");
});

test("errorMessage: mensajes claros por tipo de fallo", () => {
  assert.match(errorMessage({ code: "max_subscriptions_reached", status: 409 }), /2 horarios/);
  assert.match(errorMessage({ status: 0 }), /Sin conexión/);
  assert.match(errorMessage({ status: 404 }), /ya no existe/);
  assert.match(errorMessage({ status: 429 }), /Espera/);
  assert.match(errorMessage({ status: 502 }), /No se pudo guardar/);
  assert.match(errorMessage(null), /No se pudo guardar/);
});
