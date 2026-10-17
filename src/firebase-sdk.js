// The parts of the Firebase JS SDK Sahay uses, bundled into public/vendor/firebase-sdk.js
// (npm run bundle) so the site loads everything from its own origin under a strict CSP.
export { initializeApp } from "firebase/app";
export {
  getAuth, signInAnonymously, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut,
} from "firebase/auth";
export {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc,
  getDocs, query, where, orderBy, limit, serverTimestamp,
} from "firebase/firestore";
export { getAI, getGenerativeModel, GoogleAIBackend, Schema, ThinkingLevel } from "firebase/ai";
export { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider } from "firebase/app-check";
