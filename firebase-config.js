/**
 * firebase-config.js
 *
 * Replace the placeholder values below with your own Firebase project credentials.
 *
 * How to get them:
 *  1. Go to https://console.firebase.google.com/
 *  2. Create a project (or use an existing one)
 *  3. Add a Web App  →  copy the firebaseConfig object
 *  4. In Firestore → Rules, set:
 *       allow read, write: if true;   (for open community use)
 *
 * After pasting your config, set FIREBASE_ENABLED = true.
 */

const FIREBASE_ENABLED = true;

const firebaseConfig = {
  apiKey: "AIzaSyCr003V0-4Kih1njTN8kiNR2Thsholzwfw",
  authDomain: "roadwatch-bangalore.firebaseapp.com",
  projectId: "roadwatch-bangalore",
  storageBucket: "roadwatch-bangalore.firebasestorage.app",
  messagingSenderId: "1068583346113",
  appId: "1:1068583346113:web:2a1e6238cf084394cad940",
  measurementId: "G-08JVXPGDK5"
};

/* ── Do not edit below this line ── */
window.__FIREBASE_ENABLED__ = FIREBASE_ENABLED;
window.__FIREBASE_CONFIG__  = firebaseConfig;
