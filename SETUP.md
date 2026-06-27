# Malaz FC WC 2026 — Setup Guide

## 1 — Create a Firebase Project

1. Go to https://console.firebase.google.com and click **Add project**
2. Name it `malaz-fc-wc26` (or anything you like)
3. Disable Google Analytics (not needed)
4. Once created, go to **Build → Firestore Database → Create database**
5. Choose **Production mode** and pick a region (e.g. `us-central`)

## 2 — Add a Web App

1. In Firebase Console, click the `</>` Web icon under **Project Overview**
2. Register the app (nickname: "Malaz FC Web")
3. Copy the `firebaseConfig` object values
4. Open `firebase-config.js` in this folder and paste your values:

```js
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "malaz-fc-wc26.firebaseapp.com",
  projectId:         "malaz-fc-wc26",
  storageBucket:     "malaz-fc-wc26.appspot.com",
  messagingSenderId: "12345...",
  appId:             "1:12345...:web:abc123"
};
```

## 3 — Firestore Security Rules

In Firebase Console → Firestore → **Rules**, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users — anyone logged in (by session, no Auth) can read; writes via app logic only
    match /users/{userId} {
      allow read:  if true;
      allow write: if true;  // tighten once stable
    }

    match /matches/{matchId} {
      allow read:  if true;
      allow write: if true;
    }

    match /predictions/{predId} {
      allow read:  if true;
      allow write: if true;
    }
  }
}
```

> ⚠️ These rules are open for development. Once launched you can restrict writes by requiring the document's userId to match — but since we use PIN auth (not Firebase Auth), keep them open or add a simple secret check.

## 4 — Seed the Admin Account

In Firebase Console → Firestore → **users** collection, create a document:

```
nickname:       "Admin"
pinHash:        ""            ← leave blank; you'll set PIN on first login
isAdminAccount: true
isAdmin:        true
totalPoints:    0
disabled:       false
```

Note the auto-generated document ID — that's your admin user ID.

## 5 — Add Players

Either:
- Use the app's **Admin → Users → Add Player** tab after logging in as admin, or
- Create documents in the `users` collection manually with `nickname`, `pinHash: ""`, `totalPoints: 0`, `isAdmin: false`

Players set their own PIN on first login.

## 6 — Deploy to GitHub Pages

```bash
# Inside the malaz-fc-app/ folder:
git init
git remote add origin https://github.com/kpimdad/Malaz-FC.git
git add .
git commit -m "Initial deploy"
git push -u origin main
```

Then in GitHub → repo Settings → **Pages** → Source: **Deploy from branch** → `main` / `/ (root)`.

Your app will be live at: `https://kpimdad.github.io/Malaz-FC/`

> **Share this URL with all players via WhatsApp/email.**

## 7 — Admin Usage

- Tap the 🏆 trophy in the top-left **5 times** to open the admin login
- Or log in as the Admin user from the player select dropdown
- Admin panel tabs:
  - **Users** — add/rename/reset PIN/disable players
  - **Matches** — update TBD team names as qualifiers are decided; enter match results
  - **Bonuses** — award +50 pts (tournament winner) and +30 pts (top scoring team) after the final
  - **Backdate** — enter predictions on behalf of a player for past matches
  - **Recalc** — rescore a single match or rebuild all point totals
  - **Audit** — find any predictions submitted after lock time

## 8 — Match Flow

1. Predictions lock **5 minutes before kickoff**
2. After the match, go to **Admin → Matches**, find the match, enter the final score and click **Save Result** — this auto-scores all predictions and updates the leaderboard instantly

## Scoring

| Outcome | Points |
|---------|--------|
| Exact score | 15 pts |
| Correct result (wrong score) | 10 pts |
| Wrong result | 0 pts |
| Tournament winner bonus | +50 pts |
| Top scoring team bonus | +30 pts |
