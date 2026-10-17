// Boot for the Firebase edition: wires app.js (shared with the Cloud Run edition) to the in-browser
// backend. With a filled-in config.js it uses Firebase (Firestore, Auth, AI Logic + App Check);
// without one it runs as a local demo whose data stays in this browser.
import { loadCatalogs } from "./i18n.js";
import { loadRules } from "./rules.js";
import { loadWords } from "./voice.js";
import { loadPrompts, Gemini } from "./gemini.js";
import { Backend } from "./backend.js";
import { LocalStore, FirestoreStore } from "./store.js";
import {
  initializeApp, initializeAppCheck, ReCaptchaV3Provider, getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider,
  onAuthStateChanged, signOut,
} from "../vendor/firebase-sdk.js";

let worker = null;
const pending = new Map();
let nextId = 1;
// Frames go to a worker that runs OpenCV.js (about 11 MB, fetched on the first photo, then cached).
function analyseFrame(rgba, width, height) {
  if (!worker) {
    worker = new Worker("js/cv-worker.js", { type: "module" });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (p) (e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.q));
    };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || "image checker failed")); pending.clear(); };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, rgba, width, height }, [rgba.buffer]);
  });
}

async function init() {
  await Promise.all([loadCatalogs("."), loadRules("."), loadWords("."), loadPrompts(".")]);
  const cfg = window.SAHAY_FIREBASE;
  if (!cfg || !cfg.firebaseConfig || !cfg.firebaseConfig.apiKey) {
    const store = new LocalStore();
    const gemini = window.SAHAY_TEST_GEMINI || null; // automated tests only; never used with Firebase
    const auth = { customerUid: async () => "local-customer", officer: () => null };
    window.SAHAY_OFFICER_NAME = () => null;
    return new Backend({ store, gemini, auth, analyseFrame, mode: "local" });
  }
  const app = initializeApp(cfg.firebaseConfig);
  if (cfg.recaptchaSiteKey) {
    if (["localhost", "127.0.0.1"].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(cfg.recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
  }
  const fbAuth = getAuth(app);
  await new Promise((r) => { const stop = onAuthStateChanged(fbAuth, () => { stop(); r(); }); });
  const auth = {
    async customerUid() {
      if (!fbAuth.currentUser) await signInAnonymously(fbAuth);
      return fbAuth.currentUser.uid;
    },
    officer() {
      const u = fbAuth.currentUser;
      return u && !u.isAnonymous ? { name: u.email || u.displayName || u.uid } : null;
    },
  };
  window.SAHAY_OFFICER_SIGN_IN = () => signInWithPopup(fbAuth, new GoogleAuthProvider());
  window.SAHAY_OFFICER_SIGN_OUT = () => signOut(fbAuth);
  window.SAHAY_OFFICER_NAME = () => (auth.officer() ? auth.officer().name : null);
  const gemini = new Gemini(app, cfg.model || "gemini-3.8-flash");
  return new Backend({ store: new FirestoreStore(app), gemini, auth, analyseFrame, mode: "firebase" });
}

const ready = init();
// Set synchronously, before app.js boots, so its first request already goes here.
window.SAHAY_LOCAL_API = async (path, opts) => (await ready).handle(path, opts);
ready.catch((err) => console.error("Sahay could not start", err));
