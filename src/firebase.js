// ─── STEP 1: Paste your Firebase config here ─────────────────────────────────
// Get this from: Firebase Console → Your Project → Project Settings → Your Apps → SDK setup
// It looks exactly like this object. Replace ALL the values below.

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey:            "AIzaSyA1yIy-U9MxXlBtLyrvwgGEZnZYBrBMV90",
  authDomain:        "playoff-pool-2efdb.firebaseapp.com",
  databaseURL:       "https://playoff-pool-2efdb-default-rtdb.firebaseio.com",
  projectId:         "playoff-pool-2efdb",
  storageBucket:     "playoff-pool-2efdb.firebasestorage.app",
  messagingSenderId: "440876259367",
  appId:             "1:440876259367:web:9ba463290e5f7aa4069602"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
