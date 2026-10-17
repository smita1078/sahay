// The rules register (exported from src/sahay/rules.py). cite() refuses unknown or unverified rules,
// exactly like the Python version, so the browser cannot cite a guess either.
const RULES = new Map();

export function setRules(list) { for (const r of list) RULES.set(r.id, r); }

export async function loadRules(base = ".") {
  setRules(await (await fetch(`${base}/data/rules.json`)).json());
}

export function allRules() { return [...RULES.values()]; }

export function cite(...ids) {
  return ids.map((id) => {
    const r = RULES.get(id);
    if (!r) throw new Error(`unknown rule ${id}`);
    if (r.status !== "VERIFIED") throw new Error(`rule ${id} is not verified and must not be relied on`);
    return { id: r.id, citation: r.citation, summary: r.summary };
  });
}
