// Noticias de Mercado (S10 F5): reglas puras del carrusel de titulares. Sin DOM ni red (el render vive en views/mercado.js).
// El servidor ya normaliza (services/news.py); aqui se vuelve a validar porque el cliente no confia en lo que recibe.
import * as fmt from "./format.js";
import { nearestIndex } from "./history-math.js";

export const MAX_NEWS = 8;
export const TONES = 4; // cuantas tintas distintas hay en el CSS para las tarjetas sin imagen (data-tone 0..3)

const LANGS = new Set(["es", "en"]);
const isHttps = (url) => typeof url === "string" && url.length <= 500 && /^https:\/\/[^\s/@?#]+(?:[/?#]|$)/.test(url);

/** Respuesta de /api/market/news -> noticias validas (titular, enlace https, fecha), sin repetidas y como mucho MAX_NEWS. */
export function cleanNews(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const title = typeof it.title === "string" ? it.title.trim() : "";
    const published = typeof it.published === "string" ? Date.parse(it.published) : NaN;
    if (!title || title.length > 200 || !isHttps(it.url) || seen.has(it.url) || Number.isNaN(published)) continue;
    seen.add(it.url);
    out.push({
      title,
      url: it.url,
      source: typeof it.source === "string" ? it.source.trim().slice(0, 60) : "",
      lang: LANGS.has(it.lang) ? it.lang : "es",
      published,
      image: isHttps(it.image) ? it.image : null,
    });
    if (out.length === MAX_NEWS) break;
  }
  return out;
}

/** «BeInCrypto · hace 2 h» (sin fuente, solo la hora). */
export function newsMeta(item, now) {
  const when = fmt.relative(item.published, now);
  return item.source ? `${item.source} · ${when}` : when;
}

/** Tinta (0..TONES-1) estable por fuente para la tarjeta sin imagen: cada medio conserva su color entre recargas. */
export function newsTone(source) {
  let hash = 0;
  for (const ch of String(source || "")) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % TONES;
}

/** Diapositiva visible: la de inicio mas cercana al desplazamiento actual de la pista; -1 si no hay ninguna. */
export function currentSlide(lefts, scrollPos) {
  return nearestIndex(lefts.map((x) => ({ x })), scrollPos);
}

/** Etiquetas accesibles de la diapositiva i (0-based) de n: posicion en la secuencia original. */
export const slideLabel = (i, n) => `${i + 1} de ${n}`;
export const slideStatus = (i, n) => `Noticia ${i + 1} de ${n}`;
