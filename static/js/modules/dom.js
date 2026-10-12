// Construcción de DOM sin innerHTML: todo texto entra como nodo de texto (nunca se interpreta como HTML).
//
// props: class, text, vars (variables CSS por CSSOM, permitido por la CSP; setAttribute("style") NO lo está),
//        onXxx (manejadores), dataset, y cualquier otro atributo. null/undefined/false se omiten.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "vars") for (const [name, v] of Object.entries(value)) el.style.setProperty(name, String(v));
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Icono de trazo (cuadrícula 24, como NavIcons.kt) a partir de trazados «d». Decorativo: aria-hidden. */
export function icon(...paths) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export const ICONS = {
  refresh: ["M20 11a8 8 0 1 0-2.3 5.7", "M20 4v7h-7"],
  close: ["M6 6l12 12M18 6L6 18"],
  image: ["M4 5h16v14H4z", "M4 15l5-5 4 4 3-3 4 4"],
  copy: ["M9 9h11v11H9z", "M5 15V4h11"],
  share: ["M12 15V3", "M8 7l4-4 4 4", "M5 12v8h14v-8"],
  swap: ["M8 4v16", "M4 16l4 4 4-4", "M16 20V4", "M12 8l4-4 4 4"],
  trash: ["M4 7h16", "M10 11v6M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  chevron: ["M9 6l6 6-6 6"],
  search: ["M4 11a7 7 0 1 0 14 0 7 7 0 1 0-14 0", "M20 20l-4.5-4.5"],
};
