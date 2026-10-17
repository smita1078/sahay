// Message catalog (exported from src/sahay/i18n.py, the single source of truth).
export const LANGS = ["en", "hi", "mr"];
const CAT = {};

export function setCatalogs(catalogs) { Object.assign(CAT, catalogs); }

export async function loadCatalogs(base = ".") {
  await Promise.all(LANGS.map(async (lang) => {
    CAT[lang] = await (await fetch(`${base}/data/catalog-${lang}.json`)).json();
  }));
}

export function catalog(lang) { return CAT[lang] || CAT.en; }

// Same behaviour as the Python t(): English fallback, then the key itself; {name} placeholders.
export function t(key, lang, params) {
  const text = (CAT[lang] && CAT[lang][key]) ?? (CAT.en && CAT.en[key]);
  if (text === undefined) return key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
