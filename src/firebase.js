// ─── STEP 1: Paste your Firebase config here ─────────────────────────────────
// Get this from: Firebase Console → Your Project → Project Settings → Your Apps → SDK setup
// It looks exactly like this object. Replace ALL the values below.

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey:            "PASTE_YOUR_apiKey_HERE",
  authDomain:        "PASTE_YOUR_authDomain_HERE",
  databaseURL:       "PASTE_YOUR_databaseURL_HERE",
  projectId:         "PASTE_YOUR_projectId_HERE",
  storageBucket:     "PASTE_YOUR_storageBucket_HERE",
  messagingSenderId: "PASTE_YOUR_messagingSenderId_HERE",
  appId:             "PASTE_YOUR_appId_HERE"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
