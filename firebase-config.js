import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const FIREBASE_ENABLED = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app = null;
let auth = null;
let db = null;

if (FIREBASE_ENABLED) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export async function ensureAuth() {
  if (!FIREBASE_ENABLED) return null;
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}

export function subscribeAuth(callback) {
  if (!FIREBASE_ENABLED) {
    callback?.(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

const signalCol = uid => collection(db, 'users', uid, 'signals');

export async function loadSignals(uid) {
  if (!FIREBASE_ENABLED || !uid) return [];
  const snap = await getDocs(signalCol(uid));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function saveSignal(uid, signal) {
  if (!FIREBASE_ENABLED || !uid || !signal) return false;
  const id = signal.id || `${Date.now()}`;
  await setDoc(doc(db, 'users', uid, 'signals', id), { ...signal, id, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

export async function saveSignalsBatch(uid, signals = []) {
  if (!FIREBASE_ENABLED || !uid) return false;
  await Promise.all(signals.map(s => saveSignal(uid, s)));
  return true;
}

export async function deleteAllSignals(uid) {
  if (!FIREBASE_ENABLED || !uid) return false;
  const snap = await getDocs(signalCol(uid));
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  return true;
}

export async function saveWeights(uid, weights = {}) {
  if (!FIREBASE_ENABLED || !uid) return false;
  await setDoc(doc(db, 'users', uid, 'profile', 'weights'), { weights, updatedAt: serverTimestamp() }, { merge: true });
  return true;
}

export async function loadProfile(uid) {
  return { uid, mode: FIREBASE_ENABLED ? 'firebase' : 'local' };
}

export async function joinSharedPool(uid) {
  return { uid, joined: Boolean(uid), enabled: FIREBASE_ENABLED };
}

export async function publishToSharedPool(uid, payload) {
  if (!FIREBASE_ENABLED || !uid) return false;
  await setDoc(doc(db, 'sharedSignals', `${uid}-${Date.now()}`), { uid, payload, createdAt: serverTimestamp() });
  return true;
}
