# 🏀 NBA Playoff Pool — Setup Guide
## Get your pool live in ~20 minutes, totally free

---

## What you'll create accounts for (all free, no card needed)
1. **GitHub** — stores your code
2. **Firebase** — stores everyone's picks and results  
3. **Vercel** — publishes your app and gives you a shareable link

---

## STEP 1 — Create a GitHub account
1. Go to **github.com** → click "Sign up"
2. Use any email, create a username and password
3. Verify your email when prompted

---

## STEP 2 — Upload your code to GitHub
1. Once logged in, click the **+** button (top right) → "New repository"
2. Name it: `playoff-pool`
3. Leave everything else as default → click **"Create repository"**
4. On the next screen, click **"uploading an existing file"**
5. Drag and drop the entire `playoff-pool` folder you downloaded
6. Scroll down → click **"Commit changes"**

---

## STEP 3 — Set up Firebase (your database)
1. Go to **console.firebase.google.com**
2. Sign in with any Google account
3. Click **"Create a project"**
4. Name it `playoff-pool` → click Continue → Continue → Create project
5. Once created, click **"Realtime Database"** in the left sidebar
6. Click **"Create Database"**
7. Choose your location (pick the closest to you) → Next
8. Select **"Start in test mode"** → Enable
   _(This lets anyone read/write — fine for a pool among friends)_

### Get your Firebase config:
1. Click the **gear icon** (top left) → "Project settings"
2. Scroll down to "Your apps" → click the **</>** (Web) icon
3. Give it a nickname: `playoff-pool-web` → click "Register app"
4. You'll see a block of code that looks like this:

```
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "playoff-pool-xxx.firebaseapp.com",
  databaseURL: "https://playoff-pool-xxx-default-rtdb.firebaseio.com",
  projectId: "playoff-pool-xxx",
  storageBucket: "playoff-pool-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

5. **Copy ALL of this** — you'll need it in the next step

---

## STEP 4 — Paste your Firebase config into the code
1. Go back to your GitHub repository
2. Click on the `src` folder → click `firebase.js`
3. Click the **pencil icon** (Edit this file)
4. Replace the lines that say `PASTE_YOUR_xxx_HERE` with your actual values
5. Click **"Commit changes"**

---

## STEP 5 — Deploy with Vercel (get your shareable link)
1. Go to **vercel.com** → click "Sign up"
2. Choose **"Continue with GitHub"** — this connects them automatically
3. Click **"Add New Project"**
4. You'll see your `playoff-pool` repo — click **"Import"**
5. Leave all settings as default → click **"Deploy"**
6. Wait ~60 seconds… 🎉

Vercel will give you a URL like: **`playoff-pool-abc123.vercel.app`**

**That's your link. Share it with everyone in your pool.**

---

## STEP 6 — Using the app

### For participants:
- Open the link you shared
- Click through each series, pick the winner and number of games
- Enter their name → click Submit

### For you (admin):
- Go to the **Admin** tab
- As series finish, select the winner and games played
- Hit Save — standings update instantly for everyone

---

## Updating team names for a new season
1. Go to your GitHub repo → `src` → `bracketConfig.js`
2. Click the pencil icon to edit
3. Update the team names in the `series` arrays
4. Commit — Vercel redeploys automatically in ~30 seconds

---

## Troubleshooting

**"Firebase not connecting"**
- Make sure you pasted the `databaseURL` correctly in firebase.js
- It must include `https://` and end with `.firebaseio.com`

**"Picks aren't saving"**  
- In Firebase Console → Realtime Database → Rules, make sure it says:
  ```json
  { "rules": { ".read": true, ".write": true } }
  ```

**"I want a custom domain"** (e.g. mypool.com)
- Buy a domain at Namecheap or Google Domains (~$12/year)
- In Vercel → your project → Settings → Domains → add it

---

*Built with React + Firebase + Vercel. All free tiers.*
