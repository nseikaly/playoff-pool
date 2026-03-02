import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey:            process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain:        process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  databaseURL:       process.env.REACT_APP_FIREBASE_DATABASE_URL,
  projectId:         process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.REACT_APP_FIREBASE_APP_ID
};

// Guard: if Firebase env vars are missing (e.g. local dev without .env),
// skip initialization so the rest of the app can still render.
let db;
let auth;
try {
  if (!firebaseConfig.databaseURL) throw new Error("No Firebase databaseURL");
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
} catch (e) {
  console.warn("Firebase not configured — running in offline/preview mode:", e.message);
  db = null;
  auth = null;
}
export { db, auth };
