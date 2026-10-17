// Storage behind one small interface, with two implementations:
//  - FirestoreStore: the deployed app (Firestore on the free Spark plan, protected by firestore.rules)
//  - LocalStore: a demo mode with no Firebase project at all; data lives in this browser's
//    localStorage, shared between tabs, so the customer and officer screens can talk to each other.
// Paths are Firestore-style: "sessions/abc", "sessions/abc/relay/0001".
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs, query, where, orderBy, limit,
} from "../vendor/firebase-sdk.js";

const OPS = {
  "==": (a, b) => a === b, "!=": (a, b) => a !== b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
  "<": (a, b) => a < b, "<=": (a, b) => a <= b, in: (a, b) => b.includes(a),
};

export class LocalStore {
  constructor(key = "sahay.localdb") { this.key = key; }
  read() { try { return JSON.parse(localStorage.getItem(this.key) || "{}"); } catch (_) { return {}; } }
  write(db) { localStorage.setItem(this.key, JSON.stringify(db)); }
  async get(path) { const v = this.read()[path]; return v === undefined ? null : structuredClone(v); }
  async set(path, data) { const db = this.read(); db[path] = structuredClone(data); this.write(db); }
  async create(path, data) {
    const db = this.read();
    if (db[path]) throw new Error("already exists");
    db[path] = structuredClone(data); this.write(db);
  }
  async update(path, patch) {
    const db = this.read();
    if (!db[path]) throw new Error(`not found: ${path}`);
    db[path] = { ...db[path], ...structuredClone(patch) }; this.write(db);
  }
  async add(col, data) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    await this.set(`${col}/${id}`, data);
    return id;
  }
  async remove(path) { const db = this.read(); delete db[path]; this.write(db); }
  async list(col, { where: conds = [], order = null, max = 0 } = {}) {
    const prefix = `${col}/`;
    let rows = Object.entries(this.read())
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .map(([p, v]) => ({ id: p.slice(prefix.length), ...v }));
    for (const [f, op, v] of conds) rows = rows.filter((r) => OPS[op](r[f], v));
    if (order) {
      const [f, dir] = order;
      rows.sort((a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0) * (dir === "desc" ? -1 : 1));
    }
    return max ? rows.slice(0, max) : rows;
  }
}

export class FirestoreStore {
  constructor(app) { this.db = getFirestore(app); }
  async get(path) { const s = await getDoc(doc(this.db, path)); return s.exists() ? s.data() : null; }
  async set(path, data) { await setDoc(doc(this.db, path), data); }
  async create(path, data) { await setDoc(doc(this.db, path), data); } // rules refuse overwrites
  async update(path, patch) { await updateDoc(doc(this.db, path), patch); }
  async add(col, data) { return (await addDoc(collection(this.db, col), data)).id; }
  async remove(path) { await deleteDoc(doc(this.db, path)); }
  async list(col, { where: conds = [], order = null, max = 0 } = {}) {
    const parts = conds.map(([f, op, v]) => where(f, op, v));
    if (order) parts.push(orderBy(order[0], order[1] || "asc"));
    if (max) parts.push(limit(max));
    const snap = await getDocs(query(collection(this.db, col), ...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}
