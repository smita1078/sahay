import { readFileSync } from "node:fs";
import { setCatalogs } from "../public/js/i18n.js";
import { setRules } from "../public/js/rules.js";

const here = new URL(".", import.meta.url);
export const read = (p) => JSON.parse(readFileSync(new URL(p, here), "utf8"));
setCatalogs({ en: read("../public/data/catalog-en.json"), hi: read("../public/data/catalog-hi.json"), mr: read("../public/data/catalog-mr.json") });
setRules(read("../public/data/rules.json"));
