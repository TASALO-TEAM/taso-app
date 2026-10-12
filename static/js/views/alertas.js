// Pestaña Alertas (S6): resumen de los 4 tipos y un panel (overlay) por cada uno para ver, crear, cambiar y quitar.
// La identidad la pone el servidor con el initData; aquí nunca se manda ni se lee un uid. Sin innerHTML ni estilos en
// línea (CSP). Las horas se piden y se muestran en hora de Cuba; año y Spotlight se guardan en UTC (D7).
// La lógica pura (conversión de horas, textos de estado, mensajes de error) vive en modules/alerts.js.
import {
  addSpotlightHour, ApiError, deleteImageAlert, deletePriceAlert, deleteSpotlightHour, deleteYearAlert, getAlerts,
  putImageAlert, putYearAlert,
} from "../modules/api.js";
import {
  cubaHourToUtc, DST_NOTE, dstChangeSoon, errorMessage, fmtPrice, hourLabel, HOUR_OPTIONS, imageStatus, PRESET_HOURS,
  priceLine, priceStatus, spotlightStatus, utcHourToCuba, yearStatus,
} from "../modules/alerts.js";
import { h, icon, ICONS } from "../modules/dom.js";
import {
  canWriteToPm, confirmAction, haptic, hideBack, hideMain, requestWriteAccess, setClosingConfirmation, setMainBusy,
  showBack, showMain,
} from "../modules/sdk.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_IMAGE_TIME = "07:30"; // la hora por defecto unificada con el bot
const DEFAULT_CUBA_HOUR = 7;
const WRITE_DENIED =
  "Para enviarte las alertas, el bot necesita poder escribirte. Abre el chat con @tasalobot, pulsa «Iniciar» y vuelve a intentarlo.";

/** Monta la pestaña. ctx = { view, actions, setSubtitle }. Devuelve la función que la desmonta. */
export function mount(ctx) {
  let alive = true;
  let data = null; // respuesta de GET /alerts: { price, image, year, spotlight }, cada una con su propio ok
  let loading = true;
  let loadError = null; // null | "offline" | "api"
  let now = Date.now();
  let panel = null; // panel abierto (solo uno a la vez)
  let deepLinkDone = false;
  let writeGranted = false;

  const bannerSlot = h("div", { class: "slot" });
  const listSlot = h("div", { class: "alist" });
  ctx.view.replaceChildren(bannerSlot, listSlot);
  const refreshBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Actualizar alertas", onClick: () => load() }, icon(...ICONS.refresh));
  ctx.actions.replaceChildren(refreshBtn);

  // ---------- Datos ----------
  async function load(silent = false) {
    if (!silent) {
      loading = true;
      render();
    }
    try {
      const res = await getAlerts();
      if (!alive) return;
      data = res;
      loadError = null;
    } catch (e) {
      if (!alive) return;
      loadError = e instanceof ApiError && e.status === 0 ? "offline" : "api";
    }
    loading = false;
    now = Date.now();
    render();
    if (panel) panel.rerender();
    openDeepLink();
  }

  /** «Recibir cada día» (desde el Blog) llega como #/perfil?nueva=tspl (o el viejo #/alertas?…): abre el panel de Spotlight una sola vez. */
  function openDeepLink() {
    if (deepLinkDone || !data) return;
    deepLinkDone = true;
    if (/[?&]nueva=tspl(?:&|$)/.test(location.hash)) {
      try {
        history.replaceState(null, "", "#/perfil");
      } catch (_) {
        /* sin history: el enlace queda en la barra, no pasa nada */
      }
      openSpotlight();
    }
  }

  // ---------- Resumen ----------
  const SECTIONS = [
    { key: "price", title: "Alertas de precio", sub: "Cripto: te aviso cuando cruza un precio", status: () => priceStatus(data.price), open: () => openPrice() },
    { key: "image", title: "Imagen de El Toque", sub: "Las tasas en imagen, cada día a tu hora", status: () => imageStatus(data.image), open: () => openImage() },
    { key: "year", title: "Año y frase del día", sub: "El avance del año y una frase", status: () => yearStatus(data.year, now), open: () => openYear() },
    { key: "spotlight", title: "Spotlight diario", sub: "El resumen del mercado, hasta 2 veces al día", status: () => spotlightStatus(data.spotlight, now), open: () => openSpotlight() },
  ];

  function sectionCard(sec) {
    const st = sec.status();
    return h(
      "button",
      { type: "button", class: "card acard", "aria-label": `${sec.title}. ${st.text}`, dataset: { section: sec.key }, onClick: sec.open },
      h("span", { class: "acard-main" }, h("span", { class: "card-title", text: sec.title }), h("span", { class: "sub", text: sec.sub })),
      h("span", { class: `pill pill-${st.tone}`, text: st.text }),
      icon(...ICONS.chevron),
    );
  }

  function render() {
    refreshBtn.disabled = loading;
    refreshBtn.classList.toggle("spinning", loading);
    ctx.setSubtitle("Tus avisos en Telegram");
    const notice = data && loadError ? (loadError === "offline" || navigator.onLine === false ? "Sin conexión: puede que lo que ves no esté al día." : "No se pudo actualizar. Inténtalo de nuevo.") : null;
    bannerSlot.replaceChildren(...(notice ? [h("div", { class: "notice", role: "status", text: notice })] : []));

    if (!data) {
      if (loading || !loadError) {
        listSlot.replaceChildren(h("div", { class: "flist", "aria-busy": "true" }, [1, 2, 3, 4].map(() => h("div", { class: "skeleton" }))));
      } else {
        listSlot.replaceChildren(
          h(
            "div",
            { class: "card center" },
            h("p", { text: loadError === "offline" ? "Sin conexión. No se pudieron cargar tus alertas." : "No se pudieron cargar tus alertas." }),
            h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => load() }),
          ),
        );
      }
      return;
    }
    listSlot.replaceChildren(...SECTIONS.map(sectionCard));
  }

  // ---------- Paneles ----------
  function makePanel(title) {
    if (panel) panel.close();
    const opener = document.activeElement;
    let open = true;
    let dirty = false;
    const errorSlot = h("div", { class: "slot" });
    const content = h("div", { class: "panel" });
    const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Cerrar", onClick: () => p.requestClose() }, icon(...ICONS.close));
    const overlay = h(
      "div",
      { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "ov-head" }, h("h2", { class: "ov-title", text: title }), closeBtn),
      h("div", { class: "ov-body top" }, errorSlot, content),
    );
    const onKey = (e) => {
      if (e.key === "Escape") p.requestClose();
    };
    const p = {
      content,
      busy: false,
      rerender: () => {},
      setDirty(value) {
        if (dirty === value) return;
        dirty = value;
        setClosingConfirmation(value);
      },
      error(message) {
        errorSlot.replaceChildren(...(message ? [h("div", { class: "notice", role: "alert", text: message })] : []));
      },
      async requestClose() {
        if (p.busy) return;
        if (dirty && !(await confirmAction("Tienes cambios sin guardar. ¿Descartarlos?"))) return;
        p.close();
      },
      close() {
        if (!open) return;
        open = false;
        document.removeEventListener("keydown", onKey);
        setClosingConfirmation(false);
        hideMain();
        hideBack();
        overlay.remove();
        if (panel === p) panel = null;
        if (opener && typeof opener.focus === "function") opener.focus();
      },
    };
    document.addEventListener("keydown", onKey);
    document.getElementById("app").append(overlay);
    showBack(() => p.requestClose());
    closeBtn.focus();
    panel = p;
    return p;
  }

  /** Botón de guardar: el principal de Telegram si existe; si no, uno propio dentro del formulario. */
  function saveControl(text, onSave) {
    const useMain = Boolean(showMain(text, onSave));
    const btn = useMain ? null : h("button", { type: "button", class: "btn block", text, onClick: onSave });
    return {
      node: btn,
      busy(value) {
        if (useMain) setMainBusy(value);
        else {
          btn.disabled = value;
          btn.textContent = value ? "Guardando…" : text;
        }
      },
      setVisible(value) {
        if (useMain) {
          if (value) showMain(text, onSave);
          else hideMain();
        } else btn.hidden = !value;
      },
    };
  }

  /**
   * Ejecuta un cambio con control de «ocupado», permiso del bot (si hace falta), háptica y mensaje de error.
   * Devuelve true si salió bien.
   */
  async function mutate(p, control, fn, { needsWrite = false } = {}) {
    if (p.busy) return false;
    p.busy = true;
    control.busy(true);
    p.error("");
    try {
      if (needsWrite && !writeGranted && canWriteToPm() === false) {
        if (!(await requestWriteAccess())) {
          haptic("warning");
          p.error(WRITE_DENIED);
          return false;
        }
        writeGranted = true; // concedido: no se vuelve a preguntar en esta sesión
      }
      await fn();
      haptic("success");
      return true;
    } catch (e) {
      haptic("error");
      p.error(errorMessage(e));
      return false;
    } finally {
      p.busy = false;
      control.busy(false);
    }
  }

  const noControl = { busy() {}, setVisible() {} };

  function openUnavailable(title) {
    const p = makePanel(title);
    p.content.replaceChildren(
      h("p", { text: "No se pudo cargar esta alerta ahora mismo." }),
      h("button", { type: "button", class: "btn", text: "Reintentar", onClick: async () => { await load(true); if (alive) p.close(); } }),
    );
  }

  const field = (label, control, hint) =>
    h("label", { class: "pfield" }, h("span", { class: "label-text", text: label }), control, hint ? h("span", { class: "sub", text: hint }) : null);

  /** Grupo de botones excluyentes (como el selector de fuente de Tasas). */
  function segmented(label, options, current, onChange) {
    const buttons = options.map(([value, text]) =>
      h("button", { type: "button", class: "seg-btn", dataset: { value: String(value) }, text, onClick: () => select(value) }),
    );
    const mark = (value) => buttons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.value === String(value) ? "true" : "false"));
    function select(value) {
      mark(value);
      haptic("select");
      onChange(value);
    }
    mark(current);
    return h("div", { class: "pfield" }, h("span", { class: "label-text", text: label }), h("div", { class: "seg", role: "group", "aria-label": label }, buttons));
  }

  /** Selector de hora de Cuba (0-23) con atajos de mañana, mediodía y tarde. */
  function hourPicker(label, initial, onChange) {
    const select = h(
      "select",
      { class: "cur-select hour-select", "aria-label": label, onChange: (e) => setHour(Number(e.target.value)) },
      HOUR_OPTIONS.map((hh) => h("option", { value: String(hh), text: hourLabel(hh) })),
    );
    const chips = PRESET_HOURS.map((hh) => h("button", { type: "button", class: "chip", dataset: { hour: String(hh) }, text: hourLabel(hh), onClick: () => setHour(hh) }));
    function setHour(value) {
      select.value = String(value);
      chips.forEach((c) => c.setAttribute("aria-pressed", Number(c.dataset.hour) === value ? "true" : "false"));
      onChange(value);
    }
    select.value = String(initial);
    chips.forEach((c) => c.setAttribute("aria-pressed", Number(c.dataset.hour) === initial ? "true" : "false"));
    return {
      node: h("div", { class: "pfield" }, h("span", { class: "label-text", text: label }), h("div", { class: "hour-row" }, select, h("div", { class: "chips" }, chips))),
      get: () => Number(select.value),
    };
  }

  const dstNote = () => (dstChangeSoon(now) ? h("div", { class: "note", text: DST_NOTE }) : null);

  // ----- Precio -----
  function openPrice() {
    if (!data.price.ok) return openUnavailable("Alertas de precio");
    const p = makePanel("Alertas de precio");
    p.rerender = () => {
      if (!data.price.ok) return;
      const items = data.price.items;
      p.content.replaceChildren(
        items.length === 0
          ? h("p", { class: "empty", text: "No tienes alertas de precio activas." })
          : h("div", { class: "flist" }, items.map(priceRow)),
        h("div", { class: "note", text: "Para crear una alerta nueva usa /alert en el bot. Crearlas desde aquí llegará con la sección Mercado." }),
      );
    };
    const priceRow = (a) =>
      h(
        "div",
        { class: "card arow", dataset: { id: String(a.id) } },
        h(
          "div",
          { class: "arow-main" },
          h("div", { class: "card-title", text: a.coin }),
          h("div", { class: "sub", text: priceLine(a, fmtPrice) }),
          a.note ? h("div", { class: "sub", text: a.note }) : null,
        ),
        h("button", { type: "button", class: "icon-btn", "aria-label": `Borrar la alerta de ${a.coin}`, onClick: () => removePrice(a) }, icon(...ICONS.trash)),
      );
    async function removePrice(a) {
      if (p.busy || !(await confirmAction(`¿Borrar la alerta de ${a.coin}?`))) return;
      const ok = await mutate(p, noControl, async () => {
        await deletePriceAlert(a.id);
        data.price = { ok: true, items: data.price.items.filter((x) => x.id !== a.id) };
      });
      if (ok) {
        render();
        p.rerender();
      } else {
        load(true); // p. ej. la alerta ya no existía: se vuelve a leer la lista real
      }
    }
    p.rerender();
  }

  // ----- Imagen de El Toque -----
  function openImage() {
    if (!data.image.ok) return openUnavailable("Imagen de El Toque");
    const cfg = data.image.config;
    const initial = { time: cfg ? cfg.alert_time : DEFAULT_IMAGE_TIME, format: cfg ? cfg.format_type : "photo", enabled: cfg ? cfg.enabled : true };
    let { time, format, enabled } = initial;
    const p = makePanel("Imagen de El Toque");
    const refreshDirty = () => p.setDirty(time !== initial.time || format !== initial.format || enabled !== initial.enabled);

    const timeInput = h("input", {
      type: "time", class: "date-input", value: time, required: true, "aria-label": "Hora de envío, hora de Cuba",
      onInput: (e) => { time = e.target.value; refreshDirty(); },
    });
    const control = saveControl("Guardar", () => save());
    async function save() {
      if (!TIME_RE.test(time)) {
        haptic("warning");
        p.error("Elige una hora válida.");
        return;
      }
      const ok = await mutate(p, control, async () => {
        const res = await putImageAlert(time, format, enabled);
        data.image = { ok: true, config: res.config };
      }, { needsWrite: true });
      if (ok) {
        p.setDirty(false);
        p.close();
        render();
        load(true);
      }
    }
    async function remove() {
      if (p.busy || !(await confirmAction("¿Quitar la imagen diaria de El Toque?"))) return;
      const ok = await mutate(p, noControl, async () => {
        await deleteImageAlert();
        data.image = { ok: true, config: null };
      });
      if (ok) {
        p.setDirty(false);
        p.close();
        render();
      }
    }
    p.content.replaceChildren(
      h("p", { class: "sub", text: "Te envío la imagen de las tasas de El Toque cada día a esta hora." }),
      field("Hora (Cuba)", timeInput),
      segmented("Cómo llega", [["photo", "Foto"], ["document", "Archivo"]], format, (v) => { format = v; refreshDirty(); }),
      segmented("Estado", [[true, "Activa"], [false, "Pausada"]], enabled, (v) => { enabled = v === true || v === "true"; refreshDirty(); }),
      control.node,
      cfg ? h("button", { type: "button", class: "btn-ghost danger", text: "Quitar alerta", onClick: remove }) : null,
    );
  }

  // ----- Año y frase del día -----
  function openYear() {
    if (!data.year.ok) return openUnavailable("Año y frase del día");
    const configured = data.year.hour !== null && data.year.hour !== undefined;
    const initial = configured ? utcHourToCuba(data.year.hour, now) : DEFAULT_CUBA_HOUR;
    const p = makePanel("Año y frase del día");
    const picker = hourPicker("Hora de envío (Cuba)", initial, (v) => p.setDirty(configured ? v !== initial : false));
    const control = saveControl("Guardar", () => save());
    async function save() {
      const cuba = picker.get();
      const ok = await mutate(p, control, async () => {
        const res = await putYearAlert(cubaHourToUtc(cuba, now));
        data.year = { ok: true, hour: res.hour };
      }, { needsWrite: true });
      if (ok) {
        p.setDirty(false);
        p.close();
        render();
        load(true);
      }
    }
    async function remove() {
      if (p.busy || !(await confirmAction("¿Quitar el aviso diario del año y la frase?"))) return;
      const ok = await mutate(p, noControl, async () => {
        await deleteYearAlert();
        data.year = { ok: true, hour: null };
      });
      if (ok) {
        p.setDirty(false);
        p.close();
        render();
      }
    }
    p.content.replaceChildren(
      h("p", { class: "sub", text: "Cada día te mando cuánto va del año y una frase." }),
      picker.node,
      dstNote(),
      control.node,
      configured ? h("button", { type: "button", class: "btn-ghost danger", text: "Quitar alerta", onClick: remove }) : null,
    );
  }

  // ----- Spotlight diario (hasta 2 horarios) -----
  function openSpotlight() {
    if (!data.spotlight.ok) return openUnavailable("Spotlight diario");
    const p = makePanel("Spotlight diario");
    const picker = hourPicker("Nuevo horario (Cuba)", DEFAULT_CUBA_HOUR, () => p.error(""));
    const control = saveControl("Añadir horario", () => add());
    const listSlot2 = h("div", { class: "flist" });
    const addSlot = h("div", { class: "add-slot" });
    const fullNote = h("div", { class: "note", text: "Ya tienes 2 horarios. Quita uno para añadir otro.", hidden: true });

    function applyState(res) {
      if (res && Array.isArray(res.hours)) data.spotlight = { ok: true, hours: res.hours, max: res.max || 2 };
      else return load(true);
      return null;
    }
    p.rerender = () => {
      if (!data.spotlight.ok) return;
      const hours = data.spotlight.hours;
      const max = data.spotlight.max || 2;
      const rows = hours.map((utc) => ({ utc, cuba: utcHourToCuba(utc, now) })).sort((a, b) => a.cuba - b.cuba);
      listSlot2.replaceChildren(
        ...(rows.length === 0
          ? [h("p", { class: "empty", text: "Todavía no recibes el Spotlight. Añade un horario." })]
          : rows.map((r) =>
              h(
                "div",
                { class: "card arow", dataset: { hour: String(r.utc) } },
                h("div", { class: "arow-main" }, h("div", { class: "card-title", text: hourLabel(r.cuba) }), h("div", { class: "sub", text: "Hora de Cuba" })),
                h("button", { type: "button", class: "icon-btn", "aria-label": `Quitar el horario de las ${hourLabel(r.cuba)}`, onClick: () => remove(r) }, icon(...ICONS.trash)),
              ),
            )),
      );
      const full = hours.length >= max;
      fullNote.hidden = !full;
      addSlot.hidden = full;
      control.setVisible(!full);
    };
    async function add() {
      const utc = cubaHourToUtc(picker.get(), now);
      if (data.spotlight.hours.includes(utc)) {
        haptic("warning");
        p.error("Ya tienes ese horario.");
        return;
      }
      const ok = await mutate(p, control, async () => {
        await applyState(await addSpotlightHour(utc));
      }, { needsWrite: true });
      if (ok) {
        render();
        p.rerender();
      }
    }
    async function remove(r) {
      if (p.busy || !(await confirmAction(`¿Quitar el Spotlight de las ${hourLabel(r.cuba)}?`))) return;
      const ok = await mutate(p, noControl, async () => {
        await applyState(await deleteSpotlightHour(r.utc));
      });
      if (ok) {
        render();
        p.rerender();
      } else {
        load(true);
      }
    }
    addSlot.replaceChildren(picker.node);
    p.content.replaceChildren(
      h("p", { class: "sub", text: "Te mando el resumen del mercado hasta 2 veces al día, para comparar cómo se movió entre uno y otro." }),
      listSlot2,
      fullNote,
      addSlot,
      dstNote(),
      control.node,
    );
    p.rerender();
  }

  // ---------- Vida de la pantalla ----------
  const onVisible = () => {
    if (document.visibilityState === "visible" && !panel) load(true);
  };
  const onOnline = () => load(true);
  const onOffline = () => render();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  render();
  load();

  return () => {
    alive = false;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    if (panel) panel.close();
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
