/* ═══════════════════════════════════════════════════════
   MALAZ FC WC 2026 — app.js
   Knockout stage · Firebase Firestore · No build step
   Scoring: 15 pts exact · 10 pts correct result · 0 wrong · +5 correct pen winner (draws only)
   Bonus:  +50 tournament winner · +30 top scoring team · +20 golden boot
   ═══════════════════════════════════════════════════════ */

'use strict';

// Firebase is loaded as an ES module — destructure lazily inside init
let initializeApp, getFirestore, collection, doc, getDoc, getDocs,
    setDoc, updateDoc, query, where, orderBy, serverTimestamp, writeBatch;

async function waitForFirebase() {
  let tries = 0;
  while ((!window.firebaseApp || !window.firebaseFirestore) && tries < 150) {
    await new Promise(r => setTimeout(r, 50));
    tries++;
  }
  if (!window.firebaseApp || !window.firebaseFirestore) {
    document.body.innerHTML = `<div style="text-align:center;padding:3rem;color:#e74c3c;font-family:sans-serif">
      ⚠️ Firebase failed to load.<br>Check your internet connection and refresh.
    </div>`;
    throw new Error('Firebase not available');
  }
  ({ initializeApp }                                  = window.firebaseApp);
  ({ getFirestore, collection, doc, getDoc, getDocs,
     setDoc, updateDoc, query, where, orderBy,
     serverTimestamp, writeBatch }                    = window.firebaseFirestore);
}

// ── Subdivision flag fix ────────────────────────────────
const SUBDIVISION_FLAGS = {
  'Scotland': '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  'England':  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'Wales':    '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}',
};
function getFlag(teamName, fallback) {
  return SUBDIVISION_FLAGS[teamName] || fallback || '🏳️';
}

// ── Registration gate ──────────────────────────────────
const REGISTRATION_OPEN = false;  // set true to re-open self-registration

// ── Scoring constants ───────────────────────────────────
const PTS_EXACT   = 15;  // exact score
const PTS_RESULT  = 10;  // correct result / winner only
const PTS_PEN     =  5;  // correct penalty winner (draws only)
// Final & 3rd place bonus scoring
const PTS_EXACT_FINAL  = 25;  // exact score  — Final / Third
const PTS_RESULT_FINAL = 15;  // correct result — Final / Third
const PTS_PEN_FINAL    = 10;  // pen winner — Final / Third
// Half-time result pick (Final only)
const PTS_HT_RESULT      = 20;
const HT_RESULT_LOCK_UTC = '2026-07-19T19:00:00Z';  // Final kick-off
const PTS_CHAMP       = 50;  // tournament winner bonus
const PTS_TOPTEAM     = 30;  // top scoring team bonus
const PTS_GOLDEN_BOOT = 20;  // golden boot (top scorer) bonus

// Tournament picks lock — 5 min before first SF (Jul 14 19:00 UTC)
const TOURNAMENT_PICKS_LOCK_UTC = '2026-07-14T18:55:00Z';

// ── App State ──────────────────────────────────────────
const STATE = {
  db: null,
  session: null,
  matches: [],
  predictions: {},
  users: [],
  countdownTimers: [],
  currentPredictMatch: null,
};

// ── Rank movement helpers ──────────────────────────────
function loadPrevRanks() {
  try {
    const data = JSON.parse(localStorage.getItem('mfc2026_rankData') || '{}');
    return data.prevRanks || {};
  } catch { return {}; }
}
function saveRankSnapshot(rankedUsers, currentMatchCount) {
  try {
    const stored = JSON.parse(localStorage.getItem('mfc2026_rankData') || '{}');
    const prevMatchCount = stored.prevMatchCount || 0;
    const newCurrentRanks = {};
    rankedUsers.forEach((u, i) => { newCurrentRanks[u.id] = i + 1; });
    if (currentMatchCount > prevMatchCount) {
      localStorage.setItem('mfc2026_rankData', JSON.stringify({
        prevRanks:      stored.currentRanks || {},
        currentRanks:   newCurrentRanks,
        prevMatchCount: currentMatchCount,
      }));
    } else {
      localStorage.setItem('mfc2026_rankData', JSON.stringify({
        prevRanks:      stored.prevRanks || {},
        currentRanks:   newCurrentRanks,
        prevMatchCount,
      }));
    }
  } catch {}
}

// ── Session ────────────────────────────────────────────
const SESSION_KEY = 'mfc2026_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function saveSession(userId, nickname, isAdmin) {
  const session = { userId, nickname, isAdmin, expires: Date.now() + SESSION_TTL };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  STATE.session = { userId, nickname, isAdmin };
}
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!s || s.expires < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  } catch { return null; }
}
function clearSession() { localStorage.removeItem(SESSION_KEY); STATE.session = null; }

// ── PIN Hashing ────────────────────────────────────────
async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Toast ──────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', lock: '🔒' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] || icons.info}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── View Router ────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.querySelectorAll('.bnav-btn[data-view]').forEach(b =>
    b.classList.toggle('active', b.dataset.view === id));
  const isLogin = id === 'view-login';
  document.getElementById('app-nav').style.display    = isLogin ? 'none' : 'flex';
  document.getElementById('bottom-nav').style.display = isLogin ? 'none' : 'flex';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Time Helpers ───────────────────────────────────────
function matchMetaLabel(m) { return m.matchDay; }

function formatKickoff(isoString) {
  return new Date(isoString).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}

function timeUntil(msOrIso) {
  const ms   = typeof msOrIso === 'number' ? msOrIso : new Date(msOrIso).getTime();
  const diff = ms - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getLockMs(match) { return new Date(match.kickoffUTC).getTime() - 5 * 60 * 1000; }
function isLocked(match)  { return getLockMs(match) <= Date.now(); }
function isLastMinuteWindow(match) {
  const lockMs = getLockMs(match), now = Date.now();
  return now >= lockMs - 30 * 60 * 1000 && now < lockMs;
}

// ── Photo resize → base64 ─────────────────────────────
function resizeImageToBase64(file, size = 80) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          const min = Math.min(img.width, img.height);
          const sx  = (img.width  - min) / 2;
          const sy  = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        } catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Avatar ─────────────────────────────────────────────
const AVATAR_COLORS = [
  '#E74C3C','#3498DB','#2ECC71','#F39C12',
  '#9B59B6','#1ABC9C','#E67E22','#E91E63',
  '#00BCD4','#FF5722','#607D8B','#795548'
];
function getAvatarHTML(user, size = 36) {
  const name = user.nickname || '?';
  const idx  = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const bg   = AVATAR_COLORS[idx];
  const initials = name.slice(0, 2).toUpperCase();
  const style = `width:${size}px;height:${size}px;font-size:${Math.floor(size * 0.38)}px;line-height:${size}px;`;
  if (user.photoURL) {
    return `<img class="avatar" src="${user.photoURL}" alt="${name}" style="${style}"
      onerror="this.outerHTML='<div class=\\'avatar\\' style=\\'background:${bg};${style}\\'>${initials}</div>'">`;
  }
  return `<div class="avatar" style="background:${bg};${style}">${initials}</div>`;
}

// ── Scoring ────────────────────────────────────────────
// pPen / rPen = 'A' | 'B' | null  (penalty winner — only relevant when both scores equal)
function calculatePoints(pA, pB, rA, rB, pPen, rPen, stage = null) {
  const isFinal = stage === 'Final' || stage === 'Third';
  const E = isFinal ? PTS_EXACT_FINAL  : PTS_EXACT;
  const R = isFinal ? PTS_RESULT_FINAL : PTS_RESULT;
  const P = isFinal ? PTS_PEN_FINAL    : PTS_PEN;
  if (Math.sign(pA - pB) !== Math.sign(rA - rB)) return 0;
  let pts = (pA === rA && pB === rB) ? E : R;
  if (rA === rB && pA === pB && rPen && pPen && pPen === rPen) pts += P;
  return pts;
}

// ── Firestore ──────────────────────────────────────────
async function fetchMatches() {
  const snap = await getDocs(collection(STATE.db, 'matches'));
  const fs = {};
  snap.forEach(d => { fs[d.id] = d.data(); });
  STATE.matches = MATCHES.map(m => ({
    ...m,
    teamA:   fs[m.matchId]?.teamA   ?? m.teamA,
    teamB:   fs[m.matchId]?.teamB   ?? m.teamB,
    flagA:   fs[m.matchId]?.flagA   ?? m.flagA,
    flagB:   fs[m.matchId]?.flagB   ?? m.flagB,
    resultA:   fs[m.matchId]?.resultA   ?? null,
    resultB:   fs[m.matchId]?.resultB   ?? null,
    penWinner: fs[m.matchId]?.penWinner ?? null,
    status:    fs[m.matchId]?.status    ?? m.status,
  }));
}

async function fetchMyPredictions() {
  if (!STATE.session) return;
  const snap = await getDocs(query(
    collection(STATE.db, 'predictions'),
    where('userId', '==', STATE.session.userId)
  ));
  STATE.predictions = {};
  snap.forEach(d => { const p = d.data(); STATE.predictions[p.matchId] = p; });
}

async function fetchUsers() {
  const snap = await getDocs(collection(STATE.db, 'users'));
  STATE.users = [];
  snap.forEach(d => {
    if (!d.data().disabled && !d.data().isAdminAccount) STATE.users.push({ id: d.id, ...d.data() });
  });
  STATE.users.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
}

// ═══════════════════════════════════════════════════════
// LOGIN VIEW
// ═══════════════════════════════════════════════════════
function toSentenceCase(str) {
  // Title case: each word capitalised; short words (≤2 chars) go ALL CAPS (e.g. "kp" → "KP")
  return str.trim().split(/\s+/).map(word => {
    if (!word) return '';
    return word.length <= 2
      ? word.toUpperCase()
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

function switchLoginTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('login-panel').style.display    = isLogin ? 'block' : 'none';
  document.getElementById('register-panel').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('login-error').classList.remove('show');
  document.getElementById('register-error').classList.remove('show');
  if (!isLogin) document.getElementById('reg-name')?.focus();
  else document.getElementById('login-pin')?.focus();
}

async function initLoginView() {
  // Hide register link when registration is closed
  const goRegEl = document.getElementById('go-register');
  if (goRegEl) goRegEl.style.display = REGISTRATION_OPEN ? '' : 'none';

  const snap = await getDocs(collection(STATE.db, 'users'));
  const sel  = document.getElementById('login-user-select');
  sel.innerHTML = '<option value="">— Who are you? —</option>';
  const names = [];
  snap.forEach(d => {
    if (d.data().disabled || d.data().isAdminAccount) return;
    names.push({ id: d.id, nickname: d.data().nickname });
  });
  names.sort((a, b) => a.nickname.localeCompare(b.nickname));
  names.forEach(({ id, nickname }) => {
    const o = document.createElement('option');
    o.value = id; o.textContent = nickname;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => {
    document.getElementById('login-error').classList.remove('show');
    document.getElementById('login-pin').value = '';
    if (sel.value) document.getElementById('login-pin').focus();
  });
}

async function handleLogin() {
  const userId = document.getElementById('login-user-select').value;
  const pin    = document.getElementById('login-pin').value.trim();
  const errEl  = document.getElementById('login-error');
  const btn    = document.getElementById('login-btn');
  errEl.classList.remove('show');
  if (!userId) { errEl.textContent = 'Select your name first.'; errEl.classList.add('show'); return; }
  if (!/^\d{4}$/.test(pin)) { errEl.textContent = 'PIN must be exactly 4 digits.'; errEl.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const snap = await getDoc(doc(STATE.db, 'users', userId));
    if (!snap.exists()) throw new Error('not found');
    const user = snap.data();
    if (!user.pinHash) {
      // First login / PIN was reset — save entered PIN as the new one
      await updateDoc(doc(STATE.db, 'users', userId), { pinHash: await hashPin(pin) });
    } else if (await hashPin(pin) !== user.pinHash) {
      throw new Error('wrong pin');
    }
    saveSession(userId, user.nickname, user.isAdmin || false);
    document.getElementById('login-pin').value = '';
    await initApp();
  } catch {
    errEl.textContent = 'Wrong PIN — try again.'; errEl.classList.add('show');
    document.getElementById('login-pin').value = '';
    document.getElementById('login-pin').focus();
  }
  btn.disabled = false; btn.textContent = 'Enter ⚽';
}

async function handleRegister() {
  const errEl = document.getElementById('register-error');
  const btn   = document.getElementById('register-btn');
  errEl.classList.remove('show');

  if (!REGISTRATION_OPEN) {
    errEl.textContent = 'Registration is closed. Ask the admin to add you.';
    errEl.classList.add('show');
    return;
  }

  const rawName = document.getElementById('reg-name').value.trim();
  const pin     = document.getElementById('reg-pin').value.trim();
  const confirm = document.getElementById('reg-pin-confirm').value.trim();

  if (!rawName) { errEl.textContent = 'Enter your name.'; errEl.classList.add('show'); return; }
  if (rawName.length < 2) { errEl.textContent = 'Name must be at least 2 characters.'; errEl.classList.add('show'); return; }
  if (!/^\d{4}$/.test(pin))  { errEl.textContent = 'PIN must be exactly 4 digits.'; errEl.classList.add('show'); return; }
  if (pin !== confirm) { errEl.textContent = 'PINs do not match.'; errEl.classList.add('show'); return; }

  const nickname = toSentenceCase(rawName);

  btn.disabled = true; btn.textContent = 'Joining…';
  try {
    // Check for duplicate name (case-insensitive)
    const snap = await getDocs(collection(STATE.db, 'users'));
    let duplicate = false;
    snap.forEach(d => {
      if (!d.data().disabled &&
          (d.data().nickname || '').toLowerCase().replace(/\s+/g,'') === nickname.toLowerCase().replace(/\s+/g,''))
        duplicate = true;
    });
    if (duplicate) {
      errEl.textContent = `"${nickname}" is already taken — try a different name.`;
      errEl.classList.add('show');
      btn.disabled = false; btn.textContent = 'Join ⚽'; return;
    }

    const pinHash = await hashPin(pin);
    const newRef  = doc(collection(STATE.db, 'users'));
    await setDoc(newRef, {
      nickname,
      pinHash,
      isAdmin:        false,
      isAdminAccount: false,
      disabled:       false,
      totalPoints:     0,
      exactScores:     0,
      correctResults:  0,
      championPick:    '',
      topScorerPick:   '',
      goldenBootPick:  '',
      champBonus:      0,
      topScorerBonus:  0,
      goldenBootBonus: 0,
      photoURL:        '',
      createdAt:       serverTimestamp(),
    });

    // Account created — now log straight in
    saveSession(newRef.id, nickname, false);
    btn.textContent = '✅ Joined!';
    await new Promise(r => setTimeout(r, 600)); // brief flash
    await initApp();

  } catch (e) {
    console.error('Registration error:', e);
    errEl.textContent = e?.code === 'permission-denied'
      ? 'Permission denied — check Firestore rules.'
      : `Error: ${e?.code || e?.message || 'please try again'}`;
    errEl.classList.add('show');
    btn.disabled = false;
    btn.textContent = 'Join ⚽';
  }
}

// ── Admin login (tap trophy ×5) ────────────────────────
let _adminTapCount = 0, _adminTapTimer = null;
function onTrophyTap() {
  _adminTapCount++;
  clearTimeout(_adminTapTimer);
  _adminTapTimer = setTimeout(() => { _adminTapCount = 0; }, 3000);
  if (_adminTapCount >= 5) {
    _adminTapCount = 0;
    document.getElementById('admin-login-modal').style.display = 'flex';
    document.getElementById('admin-password-input').focus();
  }
}

async function handleAdminLogin() {
  const pw  = document.getElementById('admin-password-input').value;
  const err = document.getElementById('admin-login-error');
  err.style.display = 'none';
  if (!pw) return;
  try {
    const snap = await getDocs(collection(STATE.db, 'users'));
    let adminDoc = null;
    snap.forEach(d => { if (d.data().isAdminAccount) adminDoc = { id: d.id, ...d.data() }; });
    if (!adminDoc) { err.textContent = 'No admin account found.'; err.style.display = 'block'; return; }
    if (await hashPin(pw) !== adminDoc.pinHash) { err.textContent = 'Wrong password.'; err.style.display = 'block'; return; }
    document.getElementById('admin-login-modal').style.display = 'none';
    document.getElementById('admin-password-input').value = '';
    saveSession(adminDoc.id, adminDoc.nickname, true);
    await initApp();
  } catch (e) { err.textContent = 'Error: ' + e.message; err.style.display = 'block'; }
}

// ═══════════════════════════════════════════════════════
// CHAMPION / TOP SCORING TEAM PICKS
// ═══════════════════════════════════════════════════════
// All 48 WC 2026 qualified nations — hardcoded so users can pick any team
const ALL_WC2026_TEAMS = [
  'Albania', 'Algeria', 'Argentina', 'Australia',
  'Austria', 'Belgium', 'Bosnia & Herz.', 'Brazil',
  'Cameroon', 'Canada', 'Colombia', 'Costa Rica',
  'Croatia', 'Ecuador', 'Egypt', 'England',
  'France', 'Germany', 'Honduras', 'Hungary',
  'Indonesia', 'Iran', 'Iraq', 'Ivory Coast',
  'Japan', 'Jordan', 'Mexico', 'Morocco',
  'Netherlands', 'New Zealand', 'Nigeria', 'Norway',
  'Panama', 'Portugal', 'Saudi Arabia', 'Scotland',
  'Senegal', 'Serbia', 'South Africa', 'South Korea',
  'Spain', 'Switzerland', 'Tunisia', 'Uruguay',
  'USA', 'Uzbekistan', 'Venezuela',
];

function getKnownTeams() {
  // Merge hardcoded nations with any admin-updated real team names from Firestore
  const fromMatches = STATE.matches
    .filter(m => m.stage === 'R32')
    .flatMap(m => [m.teamA, m.teamB])
    .filter(t => !t.startsWith('TBD'));
  return [...new Set([...ALL_WC2026_TEAMS, ...fromMatches])].sort();
}

// QF-stage Golden Boot candidates (players from 8 remaining teams)
const GOLDEN_BOOT_PLAYERS = [
  'Alexander Sørloth (Norway)',
  'Álvaro Morata (Spain)',
  'Antoine Griezmann (France)',
  'Breel Embolo (Switzerland)',
  'Bukayo Saka (England)',
  'Dani Olmo (Spain)',
  'Dodi Lukebakio (Belgium)',
  'Erling Haaland (Norway)',
  'Ferran Torres (Spain)',
  'Hakim Ziyech (Morocco)',
  'Harry Kane (England)',
  'Jude Bellingham (England)',
  'Julián Álvarez (Argentina)',
  'Kevin De Bruyne (Belgium)',
  'Kylian Mbappé (France)',
  'Lamine Yamal (Spain)',
  'Lautaro Martínez (Argentina)',
  'Lionel Messi (Argentina)',
  'Marcus Thuram (France)',
  'Martin Ødegaard (Norway)',
  'Phil Foden (England)',
  'Romelu Lukaku (Belgium)',
  'Ruben Vargas (Switzerland)',
  'Soufiane Boufal (Morocco)',
  'Youssef En-Nesyri (Morocco)',
];

function populateTeamSelects() {
  const teams = getKnownTeams();
  const opts  = teams.map(t => `<option value="${t}">${t}</option>`).join('');
  const blank = '<option value="">— Pick a team —</option>';
  document.getElementById('champion-select').innerHTML    = blank + opts;
  document.getElementById('top-scorer-select').innerHTML  = blank + opts;
  const blankP = '<option value="">— Pick a player —</option>';
  document.getElementById('golden-boot-select').innerHTML = blankP +
    GOLDEN_BOOT_PLAYERS.map(p => `<option value="${p}">${p}</option>`).join('');
}

function isTournamentPicksLocked() {
  return Date.now() >= new Date(TOURNAMENT_PICKS_LOCK_UTC).getTime();
}
function isHtResultLocked() {
  return Date.now() >= new Date(HT_RESULT_LOCK_UTC).getTime();
}

async function openHtResultModal(userData = null) {
  const locked  = isHtResultLocked();
  const current = userData?.htResultPick || null;
  STATE._htResultPick = current;

  const deadlineEl = document.getElementById('ht-result-deadline');
  if (deadlineEl) {
    if (locked) {
      deadlineEl.textContent = '🔒 Pick is locked — Final has kicked off';
      deadlineEl.style.color = 'var(--red)';
      deadlineEl.style.background = 'rgba(231,76,60,0.12)';
    } else {
      const lockDate = new Date(HT_RESULT_LOCK_UTC);
      const fmt = lockDate.toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZoneName:'short' });
      deadlineEl.textContent = `⏰ Locks at kick-off: ${fmt}`;
      deadlineEl.style.color = 'var(--gold)';
      deadlineEl.style.background = 'rgba(212,175,55,0.1)';
    }
  }
  document.querySelectorAll('.ht-pick-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.val === current);
    btn.disabled = locked;
  });
  const labels = { Spain: '🇪🇸 Spain leading', Draw: '🤝 Level', Argentina: '🇦🇷 Argentina leading' };
  const selectedEl = document.getElementById('ht-pick-selected');
  if (selectedEl) selectedEl.textContent = current ? `Your pick: ${labels[current] || current}` : '';
  const saveBtn = document.getElementById('save-ht-result-btn');
  saveBtn.disabled = locked;
  saveBtn.textContent = locked ? '🔒 Locked' : 'Save Pick';
  document.getElementById('skip-ht-result-btn').textContent = (current || locked) ? 'Close' : 'Skip for now';
  document.getElementById('ht-result-modal').style.display = 'flex';
}

async function saveHtResultPick() {
  if (isHtResultLocked()) { showToast('Pick is locked — Final has kicked off', 'lock'); return; }
  const pick = STATE._htResultPick;
  if (!pick) { showToast('Select an option first', 'error'); return; }
  if (!STATE.session?.userId) { showToast('Not logged in', 'error'); return; }
  const btn = document.getElementById('save-ht-result-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await setDoc(doc(STATE.db, 'users', STATE.session.userId), { htResultPick: pick }, { merge: true });
    const labels = { Spain: '🇪🇸 Spain leading', Draw: '🤝 Level', Argentina: '🇦🇷 Argentina leading' };
    showToast(`⏱️ HT pick saved: ${labels[pick] || pick}`, 'success');
    document.getElementById('ht-result-modal').style.display = 'none';
  } catch (e) {
    showToast(`Save failed: ${e?.code || e?.message || String(e)}`, 'error');
  }
  btn.disabled = false; btn.textContent = 'Save Pick';
}

async function openChampionModal(userData = null) {
  populateTeamSelects();
  const locked = isTournamentPicksLocked();

  if (userData?.championPick)   document.getElementById('champion-select').value    = userData.championPick;
  if (userData?.topScorerPick)  document.getElementById('top-scorer-select').value  = userData.topScorerPick;
  if (userData?.goldenBootPick) document.getElementById('golden-boot-select').value = userData.goldenBootPick;

  // Deadline banner
  const deadlineEl = document.getElementById('picks-deadline');
  if (deadlineEl) {
    if (locked) {
      deadlineEl.textContent = '🔒 Picks are locked';
      deadlineEl.style.color = 'var(--red)';
      deadlineEl.style.background = 'rgba(231,76,60,0.12)';
    } else {
      const lockDate = new Date(TOURNAMENT_PICKS_LOCK_UTC);
      const fmt = lockDate.toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit', timeZoneName:'short' });
      deadlineEl.textContent = `⏰ Deadline: ${fmt}`;
      deadlineEl.style.color = 'var(--gold)';
      deadlineEl.style.background = 'rgba(212,175,55,0.1)';
    }
  }

  // Lock/unlock inputs
  ['champion-select', 'top-scorer-select', 'golden-boot-select'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = locked;
  });
  const saveBtn = document.getElementById('save-champion-btn');
  saveBtn.disabled = locked;
  saveBtn.textContent = locked ? '🔒 Picks Locked' : 'Save My Picks';

  const hasPicks = userData?.championPick && userData?.topScorerPick && userData?.goldenBootPick;
  document.getElementById('skip-champion-btn').textContent = (hasPicks || locked) ? 'Close' : 'Skip for now';
  document.getElementById('champion-modal').style.display = 'flex';
}

async function saveChampionPick() {
  if (isTournamentPicksLocked()) { showToast('Tournament picks are locked', 'lock'); return; }
  const champion   = document.getElementById('champion-select').value;
  const topScorer  = document.getElementById('top-scorer-select').value;
  const goldenBoot = document.getElementById('golden-boot-select').value;
  if (!champion || !topScorer || !goldenBoot) {
    showToast('Complete all three picks', 'error'); return;
  }
  if (!STATE.session?.userId) { showToast('Not logged in', 'error'); return; }
  const btn = document.getElementById('save-champion-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await setDoc(doc(STATE.db, 'users', STATE.session.userId),
      { championPick: champion, topScorerPick: topScorer, goldenBootPick: goldenBoot }, { merge: true });
    showToast(`🏆 ${champion} · ⚽ ${topScorer} · 👟 ${goldenBoot.split(' (')[0]}`, 'success');
    document.getElementById('champion-modal').style.display = 'none';
  } catch (e) {
    showToast(`Save failed: ${e?.code || e?.message || String(e)}`, 'error');
  }
  btn.disabled = false; btn.textContent = 'Save My Picks';
}

// ═══════════════════════════════════════════════════════
// HOME / MATCH FEED — Round navigation
// ═══════════════════════════════════════════════════════
const ROUND_ORDER = ['Round of 32','Round of 16','Quarter-Final','Semi-Final','Third Place','Final'];
const ROUND_LABEL = {
  'Round of 32':  'R32',
  'Round of 16':  'R16',
  'Quarter-Final':'QF',
  'Semi-Final':   'SF',
  'Third Place':  '3rd',
  'Final':        'Final',
};
const ROUND_DATES = {
  'Round of 32':  '28 Jun – 4 Jul',
  'Round of 16':  '4 – 7 Jul',
  'Quarter-Final':'9 – 11 Jul',
  'Semi-Final':   '14 – 15 Jul',
  'Third Place':  '18 Jul',
  'Final':        '19 Jul',
};

let activeRound = '';

async function initHomeView() {
  await Promise.all([fetchMatches(), fetchMyPredictions()]);
  buildRoundNav();
  startCountdownTimers();
}

function buildRoundNav() {
  const nav = document.getElementById('date-nav');
  nav.innerHTML = ROUND_ORDER.map(r => `
    <button class="date-pill" data-date="${r}">
      <span class="pill-md">${ROUND_LABEL[r]}</span>
      <span class="pill-sub">${ROUND_DATES[r]}</span>
    </button>`).join('');

  nav.querySelectorAll('.date-pill').forEach(btn =>
    btn.addEventListener('click', () => selectDate(btn.dataset.date)));

  // Auto-select first round with upcoming matches
  const now = Date.now();
  const upcomingRound = ROUND_ORDER.find(r =>
    STATE.matches.some(m => m.matchDay === r && new Date(m.kickoffUTC) > now)
  );
  const latestRound = ROUND_ORDER.slice().reverse().find(r =>
    STATE.matches.some(m => m.matchDay === r)
  );
  selectDate(upcomingRound || latestRound || ROUND_ORDER[0]);
}

function selectDate(round) {
  activeRound = round;
  document.querySelectorAll('.date-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.date === round));
  const active = document.querySelector(`.date-pill[data-date="${CSS.escape(round)}"]`);
  active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  const filtered = STATE.matches
    .filter(m => m.matchDay === round)
    .sort((a, b) => new Date(a.kickoffUTC) - new Date(b.kickoffUTC));

  const list = document.getElementById('match-list');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚽</div><div class="empty-state-text">No matches in this round</div></div>`;
    return;
  }
  list.innerHTML = filtered.map(renderMatchCard).join('');
  attachCardListeners();
  renderDeadlineBanner();
}

function renderMatchCard(m) {
  const pred      = STATE.predictions[m.matchId];
  const lockMs    = getLockMs(m);
  const locked    = lockMs <= Date.now() || m.status === 'locked' || m.status === 'completed';
  const countdown = timeUntil(lockMs);
  const lastMin   = !locked && isLastMinuteWindow(m);
  const completed = m.status === 'completed' && m.resultA !== null;
  const stageLabel = m.matchDay;
  const kickoffStr = new Date(m.kickoffUTC).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });

  const centerHTML = completed
    ? `<div class="fm-center">
        <div class="fm-score-line">
          <span class="fm-score">${m.resultA}</span>
          <span class="fm-dash">–</span>
          <span class="fm-score">${m.resultB}</span>
        </div>
        <div class="fm-status-label">FT</div>
      </div>`
    : `<div class="fm-center">
        <div class="fm-time">${new Date(m.kickoffUTC).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
        <div class="fm-status-label">${locked ? '🔒' : kickoffStr.split(',')[0]}</div>
      </div>`;

  const ptsCls   = p => p === PTS_EXACT ? 'exact' : p === PTS_RESULT ? 'winner' : p === 0 ? 'wrong' : 'none';
  const ptsBadge = pts =>
    pts === PTS_EXACT  ? `<span class="fm-pts exact">+${PTS_EXACT} pts ⚽</span>` :
    pts === PTS_RESULT ? `<span class="fm-pts winner">+${PTS_RESULT} pts ✓</span>` :
    pts === 0          ? `<span class="fm-pts wrong">0 pts</span>` : '';

  let pickStrip = '';
  if (completed) {
    const pts = pred?.pointsAwarded;
    const penTeam = pred?.penWinner === 'A' ? m.teamA : pred?.penWinner === 'B' ? m.teamB : null;
    pickStrip = `<div class="fm-pick-strip">
      ${pred ? `<span class="fm-pick-label">Your pick</span><span class="fm-pick-score">${pred.predictedA}–${pred.predictedB}${penTeam ? ` <span class="fm-pen-tag">🥅 ${penTeam}</span>` : ''}</span>` : '<span class="fm-pick-label text-muted">No pick made</span>'}
      ${pts != null ? ptsBadge(pts) : (!pred ? '' : '<span class="fm-pts none">Pending</span>')}
    </div>`;
  } else if (locked) {
    const penTeam = pred?.penWinner === 'A' ? m.teamA : pred?.penWinner === 'B' ? m.teamB : null;
    pickStrip = `<div class="fm-pick-strip locked">
      🔒 Locked
      ${pred ? `<span class="fm-pick-score">${pred.predictedA}–${pred.predictedB}${penTeam ? ` <span class="fm-pen-tag">🥅 ${penTeam}</span>` : ''}</span><span style="color:var(--grass);font-size:0.8rem">✓</span>` : '<span style="color:var(--muted);font-size:0.8rem">No pick</span>'}
    </div>`;
  } else {
    const urgentClass = countdown && !countdown.includes('d') && !countdown.includes('h') ? 'urgent' : '';
    const countdownHTML = countdown ? `<span class="fm-countdown ${urgentClass}">${lastMin ? '🔥' : '⏳'} ${countdown}</span>` : '';
    pickStrip = pred
      ? `<div class="fm-pick-strip has-pick">
           <span class="fm-pick-label">Your pick</span>
           <span class="fm-pick-score">${pred.predictedA}–${pred.predictedB}</span>
           <button class="fm-btn-edit" data-match="${m.matchId}">Edit</button>
           ${countdownHTML}
         </div>`
      : `<div class="fm-pick-strip predict-cta">
           <button class="fm-btn-predict" data-match="${m.matchId}">+ Predict</button>
           ${countdownHTML}
         </div>`;
  }

  return `<div class="fm-card" data-stage="${m.stage}" data-match-id="${m.matchId}">
    <div class="fm-header">${stageLabel} · ${kickoffStr}</div>
    <div class="fm-body">
      <div class="fm-team">
        <span class="fm-flag">${getFlag(m.teamA, m.flagA)}</span>
        <span class="fm-name">${m.teamA}</span>
      </div>
      ${centerHTML}
      <div class="fm-team right">
        <span class="fm-flag">${getFlag(m.teamB, m.flagB)}</span>
        <span class="fm-name">${m.teamB}</span>
      </div>
    </div>
    ${pickStrip}
  </div>`;
}

function attachCardListeners() {
  document.querySelectorAll('.fm-btn-edit, .fm-btn-predict').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openPredictView(btn.dataset.match); });
  });
}

function startCountdownTimers() {
  STATE.countdownTimers.forEach(clearInterval);
  STATE.countdownTimers = [];
  STATE.countdownTimers.push(setInterval(() => {
    document.querySelectorAll('.fm-countdown').forEach(el => {
      const card = el.closest('.fm-card');
      if (!card) return;
      const m = STATE.matches.find(x => x.matchId === card.dataset.matchId);
      if (!m) return;
      const lockMs = getLockMs(m);
      const t = timeUntil(lockMs);
      if (!t) { fetchMatches().then(() => selectDate(activeRound)); return; }
      const urgent  = !t.includes('d') && !t.includes('h');
      const lastMin = isLastMinuteWindow(m);
      el.textContent = `${lastMin ? '🔥' : '⏳'} Locks in ${t}`;
      el.classList.toggle('urgent', urgent);
    });
    renderDeadlineBanner();
  }, 30000));
}

// ═══════════════════════════════════════════════════════
// PREDICT VIEW
// ═══════════════════════════════════════════════════════
async function openPredictView(matchId) {
  const m = STATE.matches.find(x => x.matchId === matchId);
  if (!m) return;
  STATE.currentPredictMatch = m;
  const pred   = STATE.predictions[matchId];
  const locked = isLocked(m) || m.status === 'locked' || m.status === 'completed';

  document.getElementById('predict-meta').textContent    = matchMetaLabel(m);
  document.getElementById('predict-flag-a').textContent  = getFlag(m.teamA, m.flagA);
  document.getElementById('predict-flag-b').textContent  = getFlag(m.teamB, m.flagB);
  document.getElementById('predict-team-a').textContent  = m.teamA;
  document.getElementById('predict-team-b').textContent  = m.teamB;
  const koStr = new Date(m.kickoffUTC).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
  document.getElementById('predict-kickoff').textContent = `${koStr} · ${m.venue}`;
  document.getElementById('picker-flag-a').textContent   = getFlag(m.teamA, m.flagA);
  document.getElementById('picker-name-a').textContent   = m.teamA;
  document.getElementById('picker-flag-b').textContent   = getFlag(m.teamB, m.flagB);
  document.getElementById('picker-name-b').textContent   = m.teamB;

  const initA = pred?.predictedA ?? 0, initB = pred?.predictedB ?? 0;
  ['a','b'].forEach(t => {
    const el = document.getElementById(`score-${t}`);
    el.textContent = t === 'a' ? initA : initB;
    el.dataset.val = t === 'a' ? initA : initB;
  });

  // Penalty picker
  const penPickerEl = document.getElementById('predict-pen-picker');
  const penBtnA     = document.getElementById('pen-btn-a');
  const penBtnB     = document.getElementById('pen-btn-b');
  if (penPickerEl && penBtnA && penBtnB) {
    penBtnA.textContent = `${getFlag(m.teamA, m.flagA)} ${m.teamA}`;
    penBtnB.textContent = `${getFlag(m.teamB, m.flagB)} ${m.teamB}`;
    const savedPen = pred?.penWinner ?? null;
    penBtnA.classList.toggle('active', savedPen === 'A');
    penBtnB.classList.toggle('active', savedPen === 'B');
    penPickerEl.style.display = (initA === initB) ? 'block' : 'none';
    penBtnA.disabled = locked;
    penBtnB.disabled = locked;
    penBtnA.onclick = () => { penBtnA.classList.add('active'); penBtnB.classList.remove('active'); };
    penBtnB.onclick = () => { penBtnB.classList.add('active'); penBtnA.classList.remove('active'); };
  }

  document.getElementById('predict-locked-msg').style.display = locked ? 'block' : 'none';
  document.getElementById('predict-save-btn').disabled = locked;
  document.querySelectorAll('.stepper-btn').forEach(b => b.disabled = locked);

  // Update scoring labels for Final / Third place
  const isFinalStage = m.stage === 'Final' || m.stage === 'Third';
  const E = isFinalStage ? PTS_EXACT_FINAL  : PTS_EXACT;
  const R = isFinalStage ? PTS_RESULT_FINAL : PTS_RESULT;
  const P = isFinalStage ? PTS_PEN_FINAL    : PTS_PEN;
  const exactLbl  = document.getElementById('pts-exact-label');
  const resultLbl = document.getElementById('pts-result-label');
  const penLbl    = document.getElementById('pts-pen-label');
  if (exactLbl)  exactLbl.textContent  = `⚽ ${E} pts — exact score`;
  if (resultLbl) resultLbl.textContent = `✓ ${R} pts — correct result`;
  if (penLbl)    penLbl.textContent    = `🥅 +${P} pts — pen winner`;

  // HT Result inline section — Final only
  const htSection = document.getElementById('predict-ht-section');
  if (htSection) {
    const isFinal   = m.stage === 'Final';
    const htLocked  = isHtResultLocked();
    htSection.style.display = isFinal ? 'block' : 'none';
    if (isFinal) {
      const userData = STATE.users.find(u => u.id === STATE.session?.userId);
      const currentHt = userData?.htResultPick || null;
      document.querySelectorAll('.predict-ht-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.val === currentHt);
        btn.disabled = htLocked;
      });
      htSection.querySelector('.predict-ht-header span:first-child').textContent =
        htLocked ? '🔒 HT PICK LOCKED' : '⏱️ HALF-TIME RESULT?';
    }
  }

  showView('view-predict');
}

function adjustScore(team, delta) {
  const el = document.getElementById(`score-${team}`);
  const next = Math.max(0, Math.min(20, parseInt(el.dataset.val, 10) + delta));
  el.dataset.val = next; el.textContent = next;
  el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  // Show penalty picker only when scores are tied
  const sA = parseInt(document.getElementById('score-a').dataset.val, 10);
  const sB = parseInt(document.getElementById('score-b').dataset.val, 10);
  const penPickerEl = document.getElementById('predict-pen-picker');
  if (penPickerEl) penPickerEl.style.display = (sA === sB) ? 'block' : 'none';
}

async function savePrediction() {
  const m = STATE.currentPredictMatch;
  if (!m || !STATE.session) return;
  if (isLocked(m)) { showToast('Predictions are closed for this match', 'lock'); return; }
  const btn = document.getElementById('predict-save-btn');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'Saving…';

  const scoreA   = parseInt(document.getElementById('score-a').dataset.val, 10);
  const scoreB   = parseInt(document.getElementById('score-b').dataset.val, 10);
  const predId   = `${STATE.session.userId}_${m.matchId}`;
  const lastMin  = isLastMinuteWindow(m);
  const existing = STATE.predictions[m.matchId];

  // Penalty winner — only saved when predicting a draw
  let penWinner = null;
  if (scoreA === scoreB) {
    if (document.getElementById('pen-btn-a')?.classList.contains('active')) penWinner = 'A';
    else if (document.getElementById('pen-btn-b')?.classList.contains('active')) penWinner = 'B';
  }

  let saved = false;
  try {
    const pred = {
      userId: STATE.session.userId, matchId: m.matchId,
      predictedA: scoreA, predictedB: scoreB,
      penWinner,
      updatedAt: serverTimestamp(), lastMinute: lastMin,
    };
    if (!existing) pred.submittedAt = serverTimestamp();
    await setDoc(doc(STATE.db, 'predictions', predId), pred, { merge: true });
    saved = true;
    STATE.predictions[m.matchId] = { ...pred, pointsAwarded: existing?.pointsAwarded ?? null };
    showToast(lastMin
      ? `🔥 Last-minute pick! ${m.teamA} ${scoreA}–${scoreB} ${m.teamB}`
      : `Saved: ${m.teamA} ${scoreA}–${scoreB} ${m.teamB}`, 'success');
    showView('view-home');
    selectDate(activeRound);
  } catch (e) { if (!saved) showToast('Error saving — try again', 'error'); console.error(e); }
  btn.disabled = false; btn.textContent = 'Save Prediction 💾';
}

// ── Deadline banner ────────────────────────────────────
function renderDeadlineBanner() {
  const banner = document.getElementById('deadline-banner');
  if (!banner) return;
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  const soonMatch = STATE.matches
    .filter(m => { const lk = getLockMs(m); return !isLocked(m) && lk - now <= TWO_HOURS && lk > now && !STATE.predictions[m.matchId]; })
    .sort((a, b) => getLockMs(a) - getLockMs(b))[0];
  if (!soonMatch) { banner.style.display = 'none'; return; }
  const t = timeUntil(getLockMs(soonMatch));
  banner.style.display = 'flex';
  banner.innerHTML = `⚠️ <span><strong>${soonMatch.teamA} vs ${soonMatch.teamB}</strong> locks in <strong>${t}</strong> — no pick yet</span>
    <button class="banner-predict-btn" id="banner-btn">Predict now →</button>`;
  document.getElementById('banner-btn').addEventListener('click', () => openPredictView(soonMatch.matchId));
}

// ═══════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════
async function computeUserAccuracy() {
  const snap = await getDocs(collection(STATE.db, 'predictions'));
  const allPreds = {}, finished = {}, exactMap = {}, winnerMap = {}, penMap = {};
  snap.forEach(d => {
    const p = d.data();
    allPreds[p.userId] = (allPreds[p.userId] || 0) + 1;
    if (p.pointsAwarded != null) {
      finished[p.userId] = (finished[p.userId] || 0) + 1;
      // exact = 15 or 20 (exact+pen); result = 10 or 15 (result+pen, but 15 collides with exact)
      if (p.pointsAwarded >= PTS_EXACT)  { exactMap[p.userId]  = (exactMap[p.userId]  || 0) + 1; }
      if (p.pointsAwarded === PTS_RESULT) { winnerMap[p.userId] = (winnerMap[p.userId] || 0) + 1; }
      // pen bonus: only 20 (exact+pen) is unambiguous — result+pen=15 collides with PTS_EXACT
      if (p.pointsAwarded === PTS_EXACT + PTS_PEN) {
        penMap[p.userId] = (penMap[p.userId] || 0) + 1;
      }
    }
  });
  STATE.users.forEach(u => {
    const total = finished[u.id] || 0;
    u.predictionsSubmitted = allPreds[u.id]   || 0;
    u.finishedPreds        = total;
    u.computedExact        = exactMap[u.id]   || 0;
    u.computedWinner       = winnerMap[u.id]  || 0;
    u.computedPen          = penMap[u.id]     || 0;
    u.exactAccuracy        = total >= 1 ? Math.round(((exactMap[u.id]  || 0) / total) * 100) : null;
    u.resultAccuracy       = total >= 1 ? Math.round(((winnerMap[u.id] || 0) / total) * 100) : null;
  });
  STATE.users.sort((a, b) => {
    const pts = (b.totalPoints || 0) - (a.totalPoints || 0);
    if (pts !== 0) return pts;
    const exact = (b.computedExact || 0) - (a.computedExact || 0);
    if (exact !== 0) return exact;
    return (b.computedWinner || 0) - (a.computedWinner || 0);
  });
}

async function openCompareModal(userId, nickname) {
  const modal = document.getElementById('compare-modal');
  document.getElementById('compare-title').textContent = `You vs ${nickname}`;
  const body = document.getElementById('compare-body');
  body.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
  modal.style.display = 'flex';

  const snap = await getDocs(query(collection(STATE.db, 'predictions'), where('userId', '==', userId)));
  const theirPreds = {};
  snap.forEach(d => { const p = d.data(); theirPreds[p.matchId] = p; });

  const completed = STATE.matches
    .filter(m => m.status === 'completed' && m.resultA !== null)
    .sort((a, b) => new Date(b.kickoffUTC) - new Date(a.kickoffUTC));

  if (!completed.length) {
    body.innerHTML = '<p style="text-align:center;color:var(--muted);padding:1.5rem">No completed matches yet</p>';
    return;
  }

  const ptsCls   = p => p >= PTS_EXACT ? 'exact' : p === PTS_RESULT ? 'winner' : p === 0 ? 'wrong' : 'none';
  const ptsLabel = p => {
    if (p === null) return '–';
    if (p === PTS_EXACT + PTS_PEN) return `+${p} ⚽🥅`;
    if (p >= PTS_EXACT)            return `+${p} ⚽`;
    if (p === PTS_RESULT + PTS_PEN) return `+${p} ✓🥅`;
    if (p === PTS_RESULT)           return `+${p} ✓`;
    return '0 pts';
  };

  // pen winner label: show whenever user made a pick, with ✓/✗ only if match had penalties
  const penLabel = (pred, m) => {
    if (!pred?.penWinner) return '';
    const team = pred.penWinner === 'A' ? m.teamA : m.teamB;
    if (!m.penWinner) {
      return `<span class="compare-pen neutral">🥅 ${team}</span>`;
    }
    const correct = pred.penWinner === m.penWinner;
    return `<span class="compare-pen ${correct ? 'correct' : 'wrong'}">🥅 ${team}${correct ? ' ✓' : ' ✗'}</span>`;
  };

  body.innerHTML = completed.map(m => {
    const mine   = STATE.predictions[m.matchId];
    const theirs = theirPreds[m.matchId];
    const myPts  = mine?.pointsAwarded ?? null;
    const thPts  = theirs ? calculatePoints(theirs.predictedA, theirs.predictedB, m.resultA, m.resultB, theirs.penWinner, m.penWinner, m.stage) : null;
    return `<div class="compare-row">
      <div class="compare-match-label">${getFlag(m.teamA, m.flagA)} ${m.teamA} <strong>${m.resultA}–${m.resultB}</strong>${m.penWinner ? ` (pen: ${m.penWinner === 'A' ? m.teamA : m.teamB})` : ''} ${m.teamB} ${getFlag(m.teamB, m.flagB)}</div>
      <div class="compare-picks">
        <div class="compare-pick ${ptsCls(myPts)}">
          <span class="compare-who">You</span>
          <span class="compare-score">${mine ? `${mine.predictedA}–${mine.predictedB}` : '–'}</span>
          ${penLabel(mine, m)}
          <span class="compare-pts">${ptsLabel(myPts)}</span>
        </div>
        <div class="compare-pick ${ptsCls(thPts)}">
          <span class="compare-who">${nickname}</span>
          <span class="compare-score">${theirs ? `${theirs.predictedA}–${theirs.predictedB}` : '–'}</span>
          ${penLabel(theirs, m)}
          <span class="compare-pts">${ptsLabel(thPts)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function initLeaderboard() {
  document.getElementById('leaderboard-body').innerHTML =
    '<div class="loading-center"><div class="spinner"></div></div>';
  await fetchUsers();
  await computeUserAccuracy();
  renderLeaderboardTable(STATE.users);
}

function renderLeaderboardTable(users) {
  const myId      = STATE.session.userId;
  const rankIcon  = ['🥇','🥈','🥉'];
  const container = document.getElementById('leaderboard-body');
  const prevRanks = loadPrevRanks();

  if (!users.length) { container.innerHTML = '<div class="lb-empty">No data yet</div>'; return; }

  const totalCompleted = STATE.matches.filter(m => m.resultA !== null).length;

  const rows = users.map((u, i) => {
    const pts    = u.totalPoints    || 0;
    const exact  = u.computedExact  || 0;
    const winner = u.computedWinner || 0;
    const pen    = u.computedPen    || 0;
    const played = u.predictionsSubmitted || 0;
    const isMe   = u.id === myId;
    const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    const rankNum = i < 3 ? rankIcon[i] : (i + 1);

    let moveHTML = '';
    if (prevRanks[u.id] != null) {
      const diff = prevRanks[u.id] - (i + 1);
      if (diff > 0)      moveHTML = `<div class="lb-rank-move up">↑${diff}</div>`;
      else if (diff < 0) moveHTML = `<div class="lb-rank-move down">↓${Math.abs(diff)}</div>`;
      else               moveHTML = `<div class="lb-rank-move same">–</div>`;
    }

    const champ      = u.championPick    || '–';
    const topSc      = u.topScorerPick   || '–';
    const goldenBoot = u.goldenBootPick  || '–';
    const htLabels   = { Spain: '🇪🇸 Spain leading', Draw: '🤝 Level', Argentina: '🇦🇷 Argentina leading' };
    const htResult   = u.htResultPick ? (htLabels[u.htResultPick] || u.htResultPick) : '–';
    const champBonus      = u.champBonus       || 0;
    const topBonus        = u.topScorerBonus   || 0;
    const goldenBootBonus = u.goldenBootBonus  || 0;
    const htResultBonus   = u.htResultBonus    || 0;
    const totalBonus      = champBonus + topBonus + goldenBootBonus + htResultBonus;
    const penBadge        = pen > 0 ? `<div class="lb-pen-badge">⚽${pen > 1 ? `x${pen}` : ''}</div>` : '';

    const mainRow = `<tr class="lb-tr ${isMe ? 'lb-me' : ''} ${rankCls}" data-uid="${u.id}" data-nickname="${u.nickname}">
      <td class="lb-td-rank"><div class="lb-rank-num">${rankNum}</div>${moveHTML}</td>
      <td class="lb-td-player">
        <div class="lb-player-wrap">
          ${getAvatarHTML(u, 32)}
          <span class="lb-name-text">${u.nickname}${isMe ? '<span class="me-tag">YOU</span>' : ''}</span>
        </div>
      </td>
      <td class="lb-td-compare">${!isMe ? `<button class="lb-inline-compare" data-uid="${u.id}" data-nickname="${u.nickname}">⇄</button>` : ''}</td>
      <td class="lb-td-num lb-td-total">${totalCompleted}</td>
      <td class="lb-td-num lb-td-played">${played}</td>
      <td class="lb-td-num lb-td-exact">${exact}</td>
      <td class="lb-td-num lb-td-result">${winner}</td>
      <td class="lb-td-num lb-td-bonus">${totalBonus > 0 ? `<span class="lb-bonus-pts">+${totalBonus}</span>` : '–'}</td>
      <td class="lb-td-pts"><span class="lb-pts">${pts}</span>${penBadge}</td>
    </tr>`;

    const compareBtn = !isMe
      ? `<button class="lb-drawer-compare" data-uid="${u.id}" data-nickname="${u.nickname}">Compare ↗</button>` : '';

    const drawerRow = `<tr class="lb-tr-drawer" data-uid="${u.id}">
      <td colspan="9">
        <div class="lb-drawer">
          <div class="lb-drawer-picks">
            <span class="lb-drawer-pick"><span class="lb-drawer-lbl">🏆 Winner pick</span>${champ}${champBonus ? ` <span class="bonus-awarded">+${champBonus}pts</span>` : ''}</span>
            <span class="lb-drawer-pick"><span class="lb-drawer-lbl">⚽ Top Scoring Team</span>${topSc}${topBonus ? ` <span class="bonus-awarded">+${topBonus}pts</span>` : ''}</span>
            <span class="lb-drawer-pick"><span class="lb-drawer-lbl">👟 Golden Boot</span>${goldenBoot}${goldenBootBonus ? ` <span class="bonus-awarded">+${goldenBootBonus}pts</span>` : ''}</span>
            <span class="lb-drawer-pick"><span class="lb-drawer-lbl">⏱️ Final HT Result</span>${htResult}${htResultBonus ? ` <span class="bonus-awarded">+${htResultBonus}pts</span>` : ''}</span>
          </div>
          ${compareBtn}
        </div>
      </td>
    </tr>`;

    return mainRow + drawerRow;
  }).join('');

  container.innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-th-rank">#</th>
          <th class="lb-th-player">Player</th>
          <th class="lb-th-compare">⚡</th>
          <th class="lb-th-num">Done</th>
          <th class="lb-th-num">Played</th>
          <th class="lb-th-num">Exact</th>
          <th class="lb-th-num">Result</th>
          <th class="lb-th-num">Bonus</th>
          <th class="lb-th-pts">Pts</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="lb-legend">
      Exact score = <span>${PTS_EXACT}pts</span> · Correct result = <span>${PTS_RESULT}pts</span> ·
      Tournament winner = <span>+${PTS_CHAMP}pts</span> · Top scoring team = <span>+${PTS_TOPTEAM}pts</span> · Golden Boot = <span>+${PTS_GOLDEN_BOOT}pts</span>
    </div>`;

  document.getElementById('leaderboard-updated').textContent =
    `Updated ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}`;

  if (!activeRound) {
    const completedCount = STATE.matches.filter(m => m.resultA !== null).length;
    saveRankSnapshot(users, completedCount);
  }

  document.querySelectorAll('.lb-tr').forEach(row => {
    row.addEventListener('click', () => {
      const wasOpen = row.classList.contains('expanded');
      document.querySelectorAll('.lb-tr.expanded').forEach(r => r.classList.remove('expanded'));
      document.querySelectorAll('.lb-tr-drawer.open').forEach(d => d.classList.remove('open'));
      if (!wasOpen) {
        row.classList.add('expanded');
        const drawer = row.nextElementSibling;
        if (drawer?.classList.contains('lb-tr-drawer')) drawer.classList.add('open');
      }
    });
  });

  document.querySelectorAll('.lb-drawer-compare, .lb-inline-compare').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openCompareModal(btn.dataset.uid, btn.dataset.nickname);
    });
  });
}

// ═══════════════════════════════════════════════════════
// MY PREDICTIONS VIEW
// ═══════════════════════════════════════════════════════
async function initMyPredictions() {
  await Promise.all([fetchMatches(), fetchMyPredictions()]);
  renderMyPredictions();
}

function renderMyPredictions() {
  let totalPts = 0, exact = 0, winner = 0;
  const groups = {};
  STATE.matches.forEach(m => {
    const p = STATE.predictions[m.matchId];
    if (!p) return;
    if (!groups[m.matchDay]) groups[m.matchDay] = [];
    groups[m.matchDay].push({ m, p });
    const pts = p.pointsAwarded ?? 0;
    if (pts > 0) totalPts += pts;
    if (pts >= PTS_EXACT) exact++;           // 15pts exact, 20pts exact+pen
    else if (pts === PTS_RESULT || pts === PTS_RESULT + PTS_PEN) winner++;
  });

  const scored = Object.values(STATE.predictions).filter(p => p.pointsAwarded != null);
  const accuracy = scored.length > 0 ? Math.round(((exact + winner) / scored.length) * 100) : 0;

  document.getElementById('stat-pts').textContent    = totalPts;
  document.getElementById('stat-exact').textContent  = exact;
  document.getElementById('stat-winner').textContent = winner;
  document.getElementById('stat-acc').textContent    = accuracy + '%';

  const container = document.getElementById('my-preds-list');
  if (!Object.keys(groups).length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">No predictions yet — go make some!</div></div>`;
    return;
  }

  // Order rounds properly
  const orderedGroups = ROUND_ORDER.filter(r => groups[r]);
  container.innerHTML = orderedGroups.map(day => {
    const items = groups[day];
    return `<div class="matchday-group">
      <div class="matchday-label">${day}</div>
      ${items.map(({ m, p }) => {
        const pts = p.pointsAwarded;
        const ptsCls   = pts >= PTS_EXACT ? 'exact' : (pts === PTS_RESULT || pts === PTS_RESULT + PTS_PEN) ? 'winner' : pts === 0 ? 'wrong' : 'none';
        const ptsLabel = pts != null ? `+${pts}` : '–';
        const result   = m.resultA != null ? `${m.resultA} – ${m.resultB}` : null;
        // Penalty labels
        const myPenTeam  = p.penWinner === 'A' ? m.teamA : p.penWinner === 'B' ? m.teamB : null;
        const resPenTeam = m.penWinner === 'A' ? m.teamA : m.penWinner === 'B' ? m.teamB : null;
        const showPenRow = myPenTeam || resPenTeam;
        return `<div class="pred-fm-card">
          <div class="pred-fm-row">
            <div class="pred-fm-team">
              <span class="pred-fm-flag">${getFlag(m.teamA, m.flagA)}</span>
              <span class="pred-fm-name">${m.teamA}</span>
            </div>
            <div class="pred-fm-center">
              <div class="pred-fm-my-score">${p.predictedA} – ${p.predictedB}</div>
              <div class="pred-fm-score-label">MY PICK</div>
              ${result
                ? `<div class="pred-fm-result">${result}</div><div class="pred-fm-score-label">RESULT</div>`
                : `<div class="pred-fm-result pending">?–?</div><div class="pred-fm-score-label">PENDING</div>`}
            </div>
            <div class="pred-fm-team right">
              <span class="pred-fm-flag">${getFlag(m.teamB, m.flagB)}</span>
              <span class="pred-fm-name">${m.teamB}</span>
            </div>
          </div>
          ${showPenRow ? `<div class="pred-fm-pen-row">
            ${myPenTeam ? `<span class="pred-fm-pen-pick">🥅 My pen pick: <strong>${myPenTeam}</strong></span>` : ''}
            ${resPenTeam ? `<span class="pred-fm-pen-result ${myPenTeam === resPenTeam ? 'correct' : 'wrong'}">Actual: <strong>${resPenTeam}</strong></span>` : ''}
          </div>` : ''}
          <div class="pred-fm-pts ${ptsCls}">${ptsLabel} pts</div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════
let adminTab = 'users';

async function initAdminPanel() {
  if (!STATE.session?.isAdmin) { showToast('Admin access only', 'error'); return; }
  setAdminTab('users');
}

function setAdminTab(tab) {
  adminTab = tab;
  document.querySelectorAll('#view-admin .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.admin-section').forEach(s => s.style.display = s.dataset.tab === tab ? 'block' : 'none');
  if (tab === 'users')    renderAdminUsers();
  if (tab === 'matches')  renderAdminMatches();
  if (tab === 'recalc')   renderRecalcSection();
  if (tab === 'backdate') renderBackdateSection();
  if (tab === 'bonuses')  renderBonusSection();
  if (tab === 'audit')    {}
}

async function fixAllNameCasing() {
  console.log('[fixAllNameCasing] called');
  try {
    const _getDocs    = window.firebaseFirestore.getDocs;
    const _collection = window.firebaseFirestore.collection;
    const _writeBatch = window.firebaseFirestore.writeBatch;
    const _doc        = window.firebaseFirestore.doc;

    const snap = await _getDocs(_collection(STATE.db, 'users'));
    const b = _writeBatch(STATE.db);
    let count = 0;
    snap.forEach(d => {
      const raw = (d.data().nickname || '').trim();
      if (!raw) return;
      const fixed = toSentenceCase(raw);
      console.log(`[fix] "${raw}" → "${fixed}"`);
      b.update(_doc(STATE.db, 'users', d.id), { nickname: fixed });
      count++;
    });
    await b.commit();
    showToast(`Updated ${count} name${count !== 1 ? 's' : ''} to sentence case ✓`, 'success');
    renderAdminUsers();
  } catch (e) {
    console.error('[fixAllNameCasing] error:', e);
    showToast('Error: ' + e.message, 'error');
  }
}

async function renderAdminUsers() {
  await fetchUsers();
  const list = document.getElementById('admin-user-list');
  list.innerHTML = STATE.users.map(u => `
    <div class="user-row">
      <div class="user-info" style="display:flex;align-items:center;gap:.75rem">
        ${getAvatarHTML(u, 32)}
        <div>
          <div class="user-nickname">${u.nickname}</div>
          <div class="user-meta">${u.totalPoints || 0} pts${u.championPick ? ` · 🏆 ${u.championPick}` : ''}${!u.pinHash ? ' · ⚠️ No PIN set' : ''}</div>
        </div>
      </div>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-sm btn-secondary" data-rename-user="${u.id}" data-nickname="${u.nickname}">✏️ Rename</button>
        <button class="btn-sm btn-secondary" data-resetpin-user="${u.id}" data-nickname="${u.nickname}">🔑 Reset PIN</button>
        <button class="btn-sm btn-danger"    data-delete-user="${u.id}">Delete</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-rename-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.renameUser, current = btn.dataset.nickname;
      const modal   = document.getElementById('rename-user-modal');
      const input   = document.getElementById('rename-user-input');
      const errEl   = document.getElementById('rename-user-error');
      const saveBtn = document.getElementById('rename-user-btn');
      input.value = current;
      errEl.style.display = 'none';
      modal.style.display = 'flex';
      input.focus(); input.select();

      const doSave = async () => {
        const raw = input.value.trim();
        if (!raw) { errEl.textContent = 'Name cannot be empty.'; errEl.style.display = 'block'; return; }
        const nickname = toSentenceCase(raw);
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        try {
          const _updateDoc = window.firebaseFirestore.updateDoc;
          const _doc       = window.firebaseFirestore.doc;
          await _updateDoc(_doc(STATE.db, 'users', uid), { nickname });
          modal.style.display = 'none';
          showToast(`Renamed to "${nickname}"`, 'success');
          renderAdminUsers();
        } catch (e) {
          errEl.textContent = 'Error: ' + e.message;
          errEl.style.display = 'block';
          console.error('[rename] error:', e);
        } finally {
          saveBtn.disabled = false; saveBtn.textContent = 'Save';
        }
      };

      saveBtn.onclick = doSave;
      input.onkeydown = e => { if (e.key === 'Enter') doSave(); };
    });
  });
  list.querySelectorAll('[data-resetpin-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Reset PIN for ${btn.dataset.nickname}?`)) return;
      await updateDoc(doc(STATE.db, 'users', btn.dataset.resetpinUser), { pinHash: '' });
      showToast('PIN reset', 'success'); renderAdminUsers();
    });
  });
  list.querySelectorAll('[data-delete-user]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Disable this user?')) return;
      await updateDoc(doc(STATE.db, 'users', btn.dataset.deleteUser), { disabled: true });
      showToast('User disabled', 'success'); renderAdminUsers();
    });
  });
}

async function addAdminUser() {
  const raw = document.getElementById('new-nickname').value.trim();
  if (!raw) { showToast('Nickname required', 'error'); return; }
  const nickname = toSentenceCase(raw);
  try {
    const existing = await getDocs(collection(STATE.db, 'users'));
    let duplicate = false;
    existing.forEach(d => {
      if (!d.data().disabled && (d.data().nickname || '').toLowerCase().replace(/\s+/g, '') === nickname.toLowerCase().replace(/\s+/g, '')) duplicate = true;
    });
    if (duplicate) { showToast(`"${nickname}" already exists`, 'error'); return; }
    await setDoc(doc(collection(STATE.db, 'users')), {
      nickname, pinHash: '', mobile: '',
      isAdmin: false, totalPoints: 0, exactScores: 0, correctResults: 0,
      championPick: '', topScorerPick: '', goldenBootPick: '',
      champBonus: 0, topScorerBonus: 0, goldenBootBonus: 0,
      photoURL: '', createdAt: serverTimestamp()
    });
    showToast(`${nickname} added! They'll set their PIN on first login.`, 'success');
    document.getElementById('new-nickname').value = '';
    renderAdminUsers();
  } catch (e) { showToast('Error adding user', 'error'); console.error(e); }
}

function renderAdminMatches() {
  const container = document.getElementById('admin-match-list');
  const byRound = {};
  STATE.matches.forEach(m => { if (!byRound[m.matchDay]) byRound[m.matchDay] = []; byRound[m.matchDay].push(m); });

  container.innerHTML = ROUND_ORDER.filter(r => byRound[r]).map(round => `
    <div class="admin-card" style="margin-bottom:1rem">
      <div class="admin-card-head">${round}</div>
      <div class="admin-card-body" style="padding:0">
        ${byRound[round].sort((a,b) => new Date(a.kickoffUTC)-new Date(b.kickoffUTC)).map(m => {
          const hasResult = m.resultA != null && m.resultB != null;
          const penLabel  = m.penWinner ? ` · pens: ${m.penWinner === 'A' ? m.teamA : m.teamB}` : '';
          return `
          <div class="match-admin-row" style="padding:.875rem 1rem">
            <div class="match-admin-teams">
              <span>${getFlag(m.teamA, m.flagA)} ${m.teamA} vs ${m.teamB} ${getFlag(m.teamB, m.flagB)}</span>
              <span class="status-badge ${m.status}">${m.status}${hasResult ? ` · ${m.resultA}–${m.resultB}${penLabel}` : ''}</span>
            </div>
            <div class="match-admin-meta">${formatKickoff(m.kickoffUTC)}</div>
            <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.4rem">
              <input style="background:var(--pitch);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;padding:0.35rem 0.5rem;width:180px"
                id="team-a-${m.matchId}" value="${m.teamA}" placeholder="Team A name">
              <input style="background:var(--pitch);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.85rem;padding:0.35rem 0.5rem;width:180px"
                id="team-b-${m.matchId}" value="${m.teamB}" placeholder="Team B name">
              <button class="btn btn-secondary btn-sm" style="width:auto;font-size:0.72rem" onclick="updateTeamNames('${m.matchId}')">Update Teams</button>
            </div>
            <div class="result-entry" style="margin-top:0.5rem">
              <input class="result-input" id="res-a-${m.matchId}" type="number" min="0" max="20" placeholder="–" value="${m.resultA ?? ''}">
              <span class="result-dash">–</span>
              <input class="result-input" id="res-b-${m.matchId}" type="number" min="0" max="20" placeholder="–" value="${m.resultB ?? ''}">
              <button class="btn btn-secondary btn-sm" style="width:auto;font-size:0.72rem" onclick="saveMatchResult('${m.matchId}')">
                ${hasResult ? '✏️ Override' : 'Save Result'}
              </button>
              ${hasResult ? `<button class="btn btn-sm" style="width:auto;font-size:0.72rem;background:rgba(231,76,60,.15);color:var(--red);border:1px solid rgba(231,76,60,.3)" onclick="resetMatch('${m.matchId}')">🔄 Reset</button>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.35rem">
              <label style="font-size:0.78rem;color:var(--muted);white-space:nowrap">🥅 Pen winner:</label>
              <select id="pen-winner-${m.matchId}" class="form-select" style="width:auto;font-size:0.8rem;padding:0.25rem 0.5rem">
                <option value="">None</option>
                <option value="A" ${m.penWinner === 'A' ? 'selected' : ''}>${m.teamA}</option>
                <option value="B" ${m.penWinner === 'B' ? 'selected' : ''}>${m.teamB}</option>
              </select>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

async function updateTeamNames(matchId) {
  const tA = document.getElementById(`team-a-${matchId}`)?.value.trim();
  const tB = document.getElementById(`team-b-${matchId}`)?.value.trim();
  if (!tA || !tB) { showToast('Both team names required', 'error'); return; }
  try {
    await setDoc(doc(STATE.db, 'matches', matchId), { teamA: tA, teamB: tB }, { merge: true });
    const m = STATE.matches.find(x => x.matchId === matchId);
    if (m) { m.teamA = tA; m.teamB = tB; }
    showToast(`Updated: ${tA} vs ${tB}`, 'success');
  } catch (e) { showToast('Error updating teams', 'error'); console.error(e); }
}

async function saveMatchResult(matchId, autoRA, autoRB) {
  const rA = autoRA !== undefined ? autoRA : parseInt(document.getElementById(`res-a-${matchId}`)?.value, 10);
  const rB = autoRB !== undefined ? autoRB : parseInt(document.getElementById(`res-b-${matchId}`)?.value, 10);
  if (isNaN(rA) || isNaN(rB)) { showToast('Enter valid scores', 'error'); return; }
  // Pen winner only valid when result is a draw
  const penSel    = document.getElementById(`pen-winner-${matchId}`);
  const penWinner = (rA === rB && penSel?.value) ? penSel.value : null;
  try {
    await setDoc(doc(STATE.db, 'matches', matchId), { resultA: rA, resultB: rB, penWinner: penWinner ?? null, status: 'completed' }, { merge: true });
    const pSnap = await getDocs(query(collection(STATE.db, 'predictions'), where('matchId', '==', matchId)));
    const batch = writeBatch(STATE.db);
    let total = 0, exact = 0, correct = 0;
    const deltas = {};
    pSnap.forEach(d => {
      const p = d.data();
      const pts = calculatePoints(p.predictedA, p.predictedB, rA, rB, p.penWinner, penWinner, STATE.matches.find(x => x.matchId === matchId)?.stage);
      batch.update(d.ref, { pointsAwarded: pts });
      total++; if (pts === PTS_EXACT) exact++; if (pts === PTS_RESULT || pts === PTS_RESULT + PTS_PEN) correct++;
      deltas[p.userId] = (deltas[p.userId] || 0) + (pts - (p.pointsAwarded ?? 0));
    });
    await batch.commit();
    const uBatch = writeBatch(STATE.db);
    for (const [uid, delta] of Object.entries(deltas)) {
      if (delta === 0) continue;
      const s = await getDoc(doc(STATE.db, 'users', uid));
      if (s.exists()) uBatch.update(doc(STATE.db, 'users', uid), { totalPoints: (s.data().totalPoints || 0) + delta });
    }
    await uBatch.commit();
    if (autoRA === undefined) showToast(`✅ ${total} predictions scored: ${exact} exact, ${correct} correct result`, 'success');
    const m = STATE.matches.find(x => x.matchId === matchId);
    if (m) { m.resultA = rA; m.resultB = rB; m.penWinner = penWinner; m.status = 'completed'; }
  } catch (e) { showToast('Error saving result', 'error'); console.error(e); }
}

// ── Reset Match ────────────────────────────────────────
async function resetMatch(matchId) {
  if (!confirm('Reset this match? This clears the result, removes all scored points for it, and lets users predict again.')) return;
  try {
    // 1. Fetch all predictions for this match before wiping points
    const pSnap = await getDocs(query(collection(STATE.db, 'predictions'), where('matchId', '==', matchId)));
    // 2. Subtract each user's awarded points and null out pointsAwarded
    const pBatch = writeBatch(STATE.db);
    const deltas = {};
    pSnap.forEach(d => {
      const p = d.data();
      if (p.pointsAwarded) deltas[p.userId] = (deltas[p.userId] || 0) - p.pointsAwarded;
      pBatch.update(d.ref, { pointsAwarded: null });
    });
    await pBatch.commit();
    const uBatch = writeBatch(STATE.db);
    for (const [uid, delta] of Object.entries(deltas)) {
      if (delta === 0) continue;
      const s = await getDoc(doc(STATE.db, 'users', uid));
      if (s.exists()) uBatch.update(doc(STATE.db, 'users', uid), { totalPoints: Math.max(0, (s.data().totalPoints || 0) + delta) });
    }
    await uBatch.commit();
    // 3. Clear result fields on the match
    await setDoc(doc(STATE.db, 'matches', matchId), { resultA: null, resultB: null, penWinner: null, status: 'upcoming' }, { merge: true });
    const m = STATE.matches.find(x => x.matchId === matchId);
    if (m) { m.resultA = null; m.resultB = null; m.penWinner = null; m.status = 'upcoming'; }
    showToast('Match reset — users can predict again', 'success');
    renderAdminMatches();
  } catch (e) { showToast('Error resetting match: ' + e.message, 'error'); console.error(e); }
}

// ── Bonus Award ────────────────────────────────────────
function renderBonusSection() {
  document.getElementById('bonus-section-content').innerHTML = `
    <div class="admin-card">
      <div class="admin-card-head">🏆 Award Tournament Winner Bonus (+${PTS_CHAMP} pts)</div>
      <div class="admin-card-body">
        <p style="font-size:0.875rem;color:var(--muted);margin-bottom:1rem">Select the actual tournament winner to award ${PTS_CHAMP} pts to all players who picked correctly.</p>
        <div class="admin-form">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Actual Champion</label>
            <select id="bonus-champ-select" class="form-select">
              <option value="">— Select winner —</option>
              ${getKnownTeams().map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <button id="award-champ-btn" class="btn btn-primary" style="width:auto">Award Champion Bonus</button>
        </div>
      </div>
    </div>
    <div class="admin-card">
      <div class="admin-card-head">⚽ Award Top Scoring Team Bonus (+${PTS_TOPTEAM} pts)</div>
      <div class="admin-card-body">
        <p style="font-size:0.875rem;color:var(--muted);margin-bottom:1rem">Select the actual top scoring team to award ${PTS_TOPTEAM} pts to players who picked correctly.</p>
        <div class="admin-form">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Top Scoring Team</label>
            <select id="bonus-topscorer-select" class="form-select">
              <option value="">— Select team —</option>
              ${getKnownTeams().map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <button id="award-topscorer-btn" class="btn btn-primary" style="width:auto">Award Top Scorer Bonus</button>
        </div>
      </div>
    </div>
    <div class="admin-card">
      <div class="admin-card-head">👟 Award Golden Boot Bonus (+${PTS_GOLDEN_BOOT} pts)</div>
      <div class="admin-card-body">
        <p style="font-size:0.875rem;color:var(--muted);margin-bottom:1rem">Enter the actual Golden Boot winner's name to award ${PTS_GOLDEN_BOOT} pts to players who picked correctly.</p>
        <div class="admin-form">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Golden Boot Winner</label>
            <select id="bonus-goldenboot-select" class="form-select">
              <option value="">— Select player —</option>
              ${GOLDEN_BOOT_PLAYERS.map(p => `<option value="${p}">${p}</option>`).join('')}
            </select>
          </div>
          <button id="award-goldenboot-btn" class="btn btn-primary" style="width:auto">Award Golden Boot Bonus</button>
        </div>
      </div>
    </div>
    <div class="admin-card">
      <div class="admin-card-head">⏱️ Award Final HT Result Bonus (+${PTS_HT_RESULT} pts)</div>
      <div class="admin-card-body">
        <p style="font-size:0.875rem;color:var(--muted);margin-bottom:1rem">Select the actual half-time result of the Final to award ${PTS_HT_RESULT} pts to correct picks.</p>
        <div class="admin-form">
          <div class="form-group" style="margin-bottom:0">
            <label class="form-label">Half-Time Result</label>
            <select id="bonus-htresult-select" class="form-select">
              <option value="">— Select result —</option>
              <option value="Spain">🇪🇸 Spain leading</option>
              <option value="Draw">🤝 Level</option>
              <option value="Argentina">🇦🇷 Argentina leading</option>
            </select>
          </div>
          <button id="award-htresult-btn" class="btn btn-primary" style="width:auto">Award HT Result Bonus</button>
        </div>
      </div>
    </div>`;

  document.getElementById('award-champ-btn').addEventListener('click', () => awardBonus('champion'));
  document.getElementById('award-topscorer-btn').addEventListener('click', () => awardBonus('topscorer'));
  document.getElementById('award-goldenboot-btn').addEventListener('click', () => awardBonus('goldenboot'));
  document.getElementById('award-htresult-btn').addEventListener('click', () => awardBonus('htresult'));
}

async function awardBonus(type) {
  const cfg = {
    champion:   { selectId: 'bonus-champ-select',      pts: PTS_CHAMP,       pickField: 'championPick',   bonusField: 'champBonus',      label: 'Tournament Winner' },
    topscorer:  { selectId: 'bonus-topscorer-select',  pts: PTS_TOPTEAM,     pickField: 'topScorerPick',  bonusField: 'topScorerBonus',  label: 'Top Scoring Team' },
    goldenboot: { selectId: 'bonus-goldenboot-select', pts: PTS_GOLDEN_BOOT, pickField: 'goldenBootPick', bonusField: 'goldenBootBonus', label: 'Golden Boot' },
    htresult:   { selectId: 'bonus-htresult-select',   pts: PTS_HT_RESULT,   pickField: 'htResultPick',   bonusField: 'htResultBonus',   label: 'Final HT Result' },
  }[type];
  const winner     = document.getElementById(cfg.selectId).value;
  if (!winner) { showToast('Select a winner first', 'error'); return; }
  const { pts, pickField, bonusField, label } = cfg;

  if (!confirm(`Award +${pts} pts to all players who picked "${winner}" as ${label}?`)) return;

  await fetchUsers();
  const batch = writeBatch(STATE.db);
  let count = 0;
  for (const u of STATE.users) {
    if (u[pickField] === winner) {
      const newTotal = (u.totalPoints || 0) + pts;
      batch.update(doc(STATE.db, 'users', u.id), {
        totalPoints: newTotal,
        [bonusField]: pts,
      });
      count++;
    }
  }
  await batch.commit();
  showToast(`✅ +${pts} pts awarded to ${count} player${count !== 1 ? 's' : ''} who picked ${winner}`, 'success');
  renderAdminUsers();
}

// ── Recalc ─────────────────────────────────────────────
function renderRecalcSection() {
  const sel = document.getElementById('recalc-match-select');
  sel.innerHTML = '<option value="">— Select a completed match —</option>' +
    STATE.matches.filter(m => m.status === 'completed')
      .map(m => `<option value="${m.matchId}">${m.teamA} vs ${m.teamB} (${m.matchDay})</option>`).join('');
}

async function recalcMatch() {
  const id = document.getElementById('recalc-match-select').value;
  if (!id) { showToast('Select a match first', 'error'); return; }
  await saveMatchResult(id);
}

async function recalcAll() {
  if (!confirm('Rebuild ALL user point totals from scratch?')) return;
  showToast('Rebuilding…', 'info');
  try {
    const uSnap = await getDocs(collection(STATE.db, 'users'));
    const validUids = new Set(), totals = {};
    uSnap.forEach(d => { validUids.add(d.id); totals[d.id] = 0; });
    const pSnap = await getDocs(collection(STATE.db, 'predictions'));
    pSnap.forEach(d => {
      const p = d.data();
      if (p.pointsAwarded != null && validUids.has(p.userId))
        totals[p.userId] = (totals[p.userId] || 0) + p.pointsAwarded;
    });
    // Also add bonuses back in
    uSnap.forEach(d => {
      const uid = d.id;
      if (!validUids.has(uid)) return;
      totals[uid] = (totals[uid] || 0) + (d.data().champBonus || 0) + (d.data().topScorerBonus || 0) + (d.data().goldenBootBonus || 0) + (d.data().htResultBonus || 0);
    });
    const batch = writeBatch(STATE.db);
    Object.entries(totals).forEach(([uid, pts]) => batch.update(doc(STATE.db, 'users', uid), { totalPoints: pts }));
    await batch.commit();
    showToast('All totals rebuilt!', 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); console.error(e); }
}

async function rescoreAllMatches() {
  if (!confirm(`Re-score ALL predictions for ALL completed matches with current scoring (${PTS_EXACT} / ${PTS_RESULT} / 0)? This overwrites stored points.`)) return;
  showToast('Re-scoring all matches…', 'info');
  try {
    const completedMatches = STATE.matches.filter(m => m.status === 'completed' && m.resultA != null);
    let predCount = 0;
    for (const m of completedMatches) {
      const pSnap = await getDocs(query(collection(STATE.db, 'predictions'), where('matchId', '==', m.matchId)));
      if (pSnap.empty) continue;
      const batch = writeBatch(STATE.db);
      pSnap.forEach(d => {
        const p = d.data();
        batch.update(d.ref, { pointsAwarded: calculatePoints(p.predictedA, p.predictedB, m.resultA, m.resultB, p.penWinner, m.penWinner, m.stage) });
        predCount++;
      });
      await batch.commit();
    }
    await recalcAll();
    showToast(`✅ Re-scored ${predCount} predictions`, 'success');
  } catch (e) { showToast('Error: ' + e.message, 'error'); console.error(e); }
}

// ── Backdate ───────────────────────────────────────────
function renderBackdateSection() {
  const userSel = document.getElementById('backdate-user-select');
  if (!userSel) return;
  userSel.innerHTML = '<option value="">— Select player —</option>' +
    STATE.users.map(u => `<option value="${u.id}">${u.nickname}</option>`).join('');
  userSel.onchange = () => {
    if (userSel.value) loadBackdateSheet(userSel.value);
    else document.getElementById('backdate-sheet').style.display = 'none';
  };
}

async function loadBackdateSheet(userId) {
  const sheet = document.getElementById('backdate-sheet');
  const container = document.getElementById('backdate-table-container');
  const title = document.getElementById('backdate-sheet-title');
  const user = STATE.users.find(u => u.id === userId);
  title.textContent = `${user?.nickname || 'Player'}'s Predictions`;
  container.innerHTML = '<p style="padding:1.25rem;color:var(--muted)">Loading…</p>';
  sheet.style.display = 'block';

  const pastMatches = STATE.matches
    .filter(m => new Date(m.kickoffUTC) < new Date())
    .sort((a, b) => new Date(a.kickoffUTC) - new Date(b.kickoffUTC));

  const predsSnap = await getDocs(query(collection(STATE.db, 'predictions'), where('userId', '==', userId)));
  const predsMap = {};
  predsSnap.forEach(d => { predsMap[d.data().matchId] = d.data(); });
  container.innerHTML = renderBackdateTable(pastMatches, predsMap);

  // Mark dirty on input change
  container.querySelectorAll('.bd-score-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const row = inp.closest('.bd-row');
      if (!row) return;
      row.classList.add('bd-row-dirty');
      const statusEl = row.querySelector('.bd-status');
      if (statusEl) { statusEl.textContent = '~'; statusEl.className = 'bd-status bd-status-dirty'; }
    });
  });
}

function renderBackdateTable(matches, predsMap) {
  if (!matches.length) return '<p style="padding:1.25rem;color:var(--muted)">No completed matches yet.</p>';
  const rows = matches.map(m => {
    const pred = predsMap[m.matchId];
    const hasPred = pred != null;
    const date = new Date(m.kickoffUTC).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const resultStr = m.resultA != null ? `${m.resultA}–${m.resultB}` : '–';
    const rowCls = hasPred ? '' : ' bd-row-missing';
    const stCls  = hasPred ? 'bd-status-saved' : 'bd-status-missing';
    return `<div class="bd-row${rowCls}" data-match-id="${m.matchId}">
      <div class="bd-date">${date}</div>
      <div class="bd-match">${getFlag(m.teamA, m.flagA)} ${m.teamA} <span class="bd-vs">vs</span> ${m.teamB} ${getFlag(m.teamB, m.flagB)}</div>
      <div class="bd-inputs">
        <input class="bd-score-input" type="number" min="0" max="20" value="${hasPred ? pred.predictedA : ''}" data-match-id="${m.matchId}" data-field="a" placeholder="–">
        <span class="bd-dash">–</span>
        <input class="bd-score-input" type="number" min="0" max="20" value="${hasPred ? pred.predictedB : ''}" data-match-id="${m.matchId}" data-field="b" placeholder="–">
      </div>
      <div class="bd-result">${resultStr}</div>
      <div class="bd-status ${stCls}" id="bd-status-${m.matchId}">${hasPred ? '✓' : '!'}</div>
    </div>`;
  }).join('');
  return `<div class="bd-header">
    <div class="bd-date">Date</div>
    <div class="bd-match">Match</div>
    <div class="bd-inputs">Prediction</div>
    <div class="bd-result">Result</div>
    <div class="bd-status"></div>
  </div>${rows}`;
}

async function saveAllBackdatePredictions() {
  const userId = document.getElementById('backdate-user-select').value;
  if (!userId) return;
  const rowData = {};
  document.querySelectorAll('.bd-row.bd-row-dirty .bd-score-input').forEach(inp => {
    const matchId = inp.dataset.matchId, field = inp.dataset.field, val = inp.value.trim();
    if (!rowData[matchId]) rowData[matchId] = {};
    if (val !== '') rowData[matchId][field] = parseInt(val, 10);
  });
  const toSave = Object.entries(rowData).filter(([, v]) => v.a !== undefined && v.b !== undefined);
  if (!toSave.length) { showToast('No predictions to save', 'info'); return; }
  const btn = document.getElementById('backdate-save-all-btn');
  btn.disabled = true; btn.textContent = `Saving ${toSave.length}…`;
  let saved = 0, errors = 0;
  for (const [matchId, scores] of toSave) {
    try {
      const m = STATE.matches.find(x => x.matchId === matchId);
      if (!m) continue;
      const predId = `${userId}_${matchId}`;
      const pA = scores.a, pB = scores.b;
      const pts = m.resultA != null ? calculatePoints(pA, pB, m.resultA, m.resultB, null, m.penWinner, m.stage) : null;
      const existingSnap = await getDoc(doc(STATE.db, 'predictions', predId));
      const oldPts = existingSnap.exists() ? (existingSnap.data().pointsAwarded ?? 0) : 0;
      await setDoc(doc(STATE.db, 'predictions', predId), {
        userId, matchId, predictedA: pA, predictedB: pB,
        updatedAt: serverTimestamp(),
        ...(existingSnap.exists() ? {} : { submittedAt: serverTimestamp() }),
        lastMinute: false, backdated: true,
        ...(pts !== null ? { pointsAwarded: pts } : {}),
      }, { merge: true });
      if (pts !== null) {
        const delta = pts - oldPts;
        if (delta !== 0) {
          const uSnap = await getDoc(doc(STATE.db, 'users', userId));
          if (uSnap.exists()) await updateDoc(doc(STATE.db, 'users', userId), { totalPoints: (uSnap.data().totalPoints || 0) + delta });
        }
      }
      const statusEl = document.getElementById(`bd-status-${matchId}`);
      if (statusEl) {
        statusEl.textContent = '✓'; statusEl.className = 'bd-status bd-status-saved';
        statusEl.closest('.bd-row')?.classList.remove('bd-row-missing', 'bd-row-dirty');
      }
      saved++;
    } catch (e) { console.error('Error saving', matchId, e); errors++; }
  }
  btn.disabled = false; btn.textContent = 'Save All Changes';
  showToast(`✅ Saved ${saved} prediction${saved !== 1 ? 's' : ''}${errors ? ` · ${errors} error(s)` : ''}`, 'success');
}

// ── Audit ──────────────────────────────────────────────
async function runIntegrityAudit() {
  const resultsEl = document.getElementById('audit-results');
  resultsEl.innerHTML = '<p style="color:var(--silver);font-size:0.875rem">Running audit…</p>';
  try {
    const [uSnap, pSnap] = await Promise.all([getDocs(collection(STATE.db, 'users')), getDocs(collection(STATE.db, 'predictions'))]);
    const nickMap = {};
    uSnap.forEach(d => { nickMap[d.id] = d.data().nickname || d.id; });
    const lockMap = {};
    STATE.matches.forEach(m => { lockMap[m.matchId] = new Date(m.kickoffUTC).getTime() - 5 * 60 * 1000; });
    const suspicious = [];
    pSnap.forEach(d => {
      const p = d.data();
      if (p.backdated === true || !p.updatedAt) return;
      const lockMs = lockMap[p.matchId];
      if (!lockMs) return;
      const updMs = p.updatedAt.toMillis ? p.updatedAt.toMillis() : p.updatedAt.seconds * 1000;
      if (updMs > lockMs) suspicious.push({
        user: nickMap[p.userId] || p.userId, matchId: p.matchId,
        score: `${p.predictedA}–${p.predictedB}`, pts: p.pointsAwarded ?? '?',
        updatedAt: new Date(updMs).toISOString().slice(0,19)+' UTC',
        minsAfterLock: Math.round((updMs - lockMs) / 60000),
      });
    });
    if (!suspicious.length) {
      resultsEl.innerHTML = '<p style="color:#2ecc71;font-size:0.9rem">✅ No suspicious predictions found.</p>'; return;
    }
    const byUser = {};
    suspicious.forEach(s => { if (!byUser[s.user]) byUser[s.user] = []; byUser[s.user].push(s); });
    resultsEl.innerHTML = `<p style="color:#e67e22;font-size:0.875rem;margin-bottom:1rem">⚠️ Found ${suspicious.length} suspicious prediction(s) across ${Object.keys(byUser).length} user(s).</p>` +
      Object.entries(byUser).map(([user, rows]) =>
        `<div style="margin-bottom:1rem"><div style="font-weight:700;color:var(--gold);margin-bottom:.4rem">${user} — ${rows.length} suspicious</div>
        ${rows.map(r => `<div style="font-size:0.8rem;color:var(--silver);padding:.3rem 0;border-top:1px solid var(--border)">${r.matchId}: ${r.score} (${r.pts}pts) · +${r.minsAfterLock}min after lock</div>`).join('')}</div>`
      ).join('');
  } catch (e) { resultsEl.innerHTML = `<p style="color:var(--red)">Error: ${e.message}</p>`; }
}

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function initApp() {
  const session = STATE.session || loadSession();
  if (!session) { showView('view-login'); initLoginView(); return; }
  STATE.session = session;

  // Topbar
  const avatarEl = document.getElementById('topbar-avatar');
  if (avatarEl) avatarEl.innerHTML = getAvatarHTML({ nickname: session.nickname }, 32);
  const nameEl = document.getElementById('nav-user-name');
  if (nameEl) nameEl.textContent = session.nickname;
  const adminBtn = document.getElementById('admin-nav-btn');
  if (adminBtn) adminBtn.style.display = session.isAdmin ? 'flex' : 'none';

  await fetchMatches();
  await fetchMyPredictions();

  showView('view-home');
  buildRoundNav();
  startCountdownTimers();

  // Prompt tournament picks if not fully set and still open
  try {
    const uSnap = await getDoc(doc(STATE.db, 'users', session.userId));
    if (uSnap.exists()) {
      const userData = uSnap.data();
      const allSet = userData.championPick && userData.topScorerPick && userData.goldenBootPick;
      if (!allSet && !isTournamentPicksLocked()) {
        setTimeout(() => openChampionModal(userData), 1000);
      }
      if (!userData.htResultPick && !isHtResultLocked()) {
        setTimeout(() => openHtResultModal(userData), 1500);
      }
    }
  } catch (e) { console.warn('Could not fetch user doc for champion prompt', e); }
}

// ── Wire up DOM events ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await waitForFirebase();
  const app = initializeApp(FIREBASE_CONFIG);
  STATE.db  = getFirestore(app);

  // Bottom nav
  document.querySelectorAll('.bnav-btn[data-view]').forEach(btn =>
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      showView(view);
      if (view === 'view-home')        initHomeView();
      if (view === 'view-leaderboard') initLeaderboard();
      if (view === 'view-my-preds')    initMyPredictions();
      if (view === 'view-admin')       initAdminPanel();
    })
  );

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    clearSession(); STATE.predictions = {}; STATE.users = []; STATE.matches = [];
    STATE.countdownTimers.forEach(clearInterval); STATE.countdownTimers = [];
    showView('view-login'); initLoginView();
  });

  // Login / Register switcher links
  document.getElementById('go-register').addEventListener('click', e => { e.preventDefault(); switchLoginTab('register'); });
  document.getElementById('go-login').addEventListener('click',    e => { e.preventDefault(); switchLoginTab('login'); });

  // Login
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('login-pin').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  // Register
  document.getElementById('register-btn').addEventListener('click', handleRegister);
  document.getElementById('reg-pin-confirm').addEventListener('keydown', e => { if (e.key === 'Enter') handleRegister(); });
  document.getElementById('reg-name').addEventListener('blur', e => {
    if (e.target.value.trim()) e.target.value = toSentenceCase(e.target.value);
  });

  // Trophy/badge tap → admin (touchend to prevent double-fire with synthetic click)
  ['nav-trophy', 'login-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('touchend', e => { e.preventDefault(); onTrophyTap(); }, { passive: false });
      el.addEventListener('click', onTrophyTap);
    }
  });

  // Avatar → Change PIN
  document.getElementById('topbar-avatar-wrap')?.addEventListener('click', () => {
    if (!STATE.session) return;
    ['change-pin-current','change-pin-new','change-pin-confirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const err = document.getElementById('change-pin-error');
    if (err) { err.style.display = 'none'; }
    document.getElementById('change-pin-modal').style.display = 'flex';
    document.getElementById('change-pin-current').focus();
  });
  document.getElementById('change-pin-close').addEventListener('click', () => {
    document.getElementById('change-pin-modal').style.display = 'none';
  });
  document.getElementById('rename-user-close').addEventListener('click', () => {
    document.getElementById('rename-user-modal').style.display = 'none';
  });
  document.getElementById('change-pin-btn').addEventListener('click', async () => {
    const curr    = document.getElementById('change-pin-current').value.trim();
    const next    = document.getElementById('change-pin-new').value.trim();
    const confirm = document.getElementById('change-pin-confirm').value.trim();
    const errEl   = document.getElementById('change-pin-error');
    const show = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
    errEl.style.display = 'none';
    if (!/^\d{4}$/.test(curr)) return show('Current PIN must be 4 digits.');
    if (!/^\d{4}$/.test(next)) return show('New PIN must be 4 digits.');
    if (next !== confirm)       return show('New PINs don\'t match.');
    if (curr === next)          return show('New PIN must be different.');
    const btn = document.getElementById('change-pin-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const snap = await getDoc(doc(STATE.db, 'users', STATE.session.userId));
      if (!snap.exists()) throw new Error('User not found');
      if (await hashPin(curr) !== snap.data().pinHash) { btn.disabled = false; btn.textContent = 'Update PIN'; return show('Current PIN is wrong.'); }
      await updateDoc(doc(STATE.db, 'users', STATE.session.userId), { pinHash: await hashPin(next) });
      document.getElementById('change-pin-modal').style.display = 'none';
      showToast('PIN updated ✓', 'success');
    } catch (e) { show('Error: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Update PIN';
  });

  // Admin modal
  document.getElementById('admin-login-btn').addEventListener('click', handleAdminLogin);
  document.getElementById('admin-login-close').addEventListener('click', () => {
    document.getElementById('admin-login-modal').style.display = 'none';
  });
  document.getElementById('admin-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') handleAdminLogin(); });

  // PIN toggle
  document.getElementById('pin-toggle')?.addEventListener('click', () => {
    const inp = document.getElementById('login-pin');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Predict view steppers
  document.getElementById('stepper-plus-a').addEventListener('click',  () => adjustScore('a', +1));
  document.getElementById('stepper-minus-a').addEventListener('click', () => adjustScore('a', -1));
  document.getElementById('stepper-plus-b').addEventListener('click',  () => adjustScore('b', +1));
  document.getElementById('stepper-minus-b').addEventListener('click', () => adjustScore('b', -1));
  document.getElementById('predict-save-btn').addEventListener('click', savePrediction);
  document.getElementById('predict-back-btn').addEventListener('click', () => { showView('view-home'); selectDate(activeRound); });

  // Champion modal
  document.getElementById('save-champion-btn').addEventListener('click', saveChampionPick);
  document.getElementById('skip-champion-btn').addEventListener('click', () => { document.getElementById('champion-modal').style.display = 'none'; });
  document.getElementById('close-champion-btn').addEventListener('click', () => { document.getElementById('champion-modal').style.display = 'none'; });

  // HT result modal
  document.getElementById('save-ht-result-btn').addEventListener('click', saveHtResultPick);
  document.getElementById('skip-ht-result-btn').addEventListener('click', () => { document.getElementById('ht-result-modal').style.display = 'none'; });
  document.getElementById('close-ht-result-btn').addEventListener('click', () => { document.getElementById('ht-result-modal').style.display = 'none'; });
  document.querySelectorAll('.ht-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      STATE._htResultPick = btn.dataset.val;
      document.querySelectorAll('.ht-pick-btn').forEach(b => b.classList.toggle('selected', b === btn));
      const labels = { Spain: '🇪🇸 Spain leading', Draw: '🤝 Level', Argentina: '🇦🇷 Argentina leading' };
      const sel = document.getElementById('ht-pick-selected');
      if (sel) sel.textContent = `Your pick: ${labels[btn.dataset.val]}`;
    });
  });

  // HT result inline pick on prediction card (Final only — auto-saves on tap)
  document.querySelectorAll('.predict-ht-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled || isHtResultLocked()) return;
      if (!STATE.session?.userId) return;
      const pick = btn.dataset.val;
      document.querySelectorAll('.predict-ht-btn').forEach(b => b.classList.toggle('selected', b === btn));
      const labels = { Spain: '🇪🇸 Spain leading', Draw: '🤝 Level', Argentina: '🇦🇷 Argentina leading' };
      try {
        await setDoc(doc(STATE.db, 'users', STATE.session.userId), { htResultPick: pick }, { merge: true });
        // Update local cache
        const u = STATE.users.find(x => x.id === STATE.session.userId);
        if (u) u.htResultPick = pick;
        showToast(`⏱️ HT pick: ${labels[pick]}`, 'success');
      } catch (e) { showToast('Save failed', 'error'); }
    });
  });
  document.getElementById('my-picks-btn').addEventListener('click', async () => {
    const uSnap = await getDoc(doc(STATE.db, 'users', STATE.session.userId));
    openChampionModal(uSnap.exists() ? uSnap.data() : null);
  });

  // Compare modal close
  document.getElementById('compare-modal-close').addEventListener('click', () => {
    document.getElementById('compare-modal').style.display = 'none';
  });

  // Profile / avatar
  document.getElementById('topbar-avatar-wrap').addEventListener('click', async () => {
    const modal = document.getElementById('profile-modal');
    const uSnap = await getDoc(doc(STATE.db, 'users', STATE.session.userId));
    const userData = uSnap.exists() ? uSnap.data() : {};
    document.getElementById('profile-name').textContent = STATE.session.nickname;
    const preview = document.getElementById('profile-avatar-preview');
    preview.innerHTML = getAvatarHTML(userData, 90);
    modal.style.display = 'flex';
  });
  document.getElementById('profile-modal-close').addEventListener('click', () => { document.getElementById('profile-modal').style.display = 'none'; });
  document.getElementById('profile-photo-input').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const b64 = await resizeImageToBase64(file, 80);
    document.getElementById('profile-avatar-preview').innerHTML = `<img src="${b64}" style="width:90px;height:90px;border-radius:50%;object-fit:cover">`;
    document.getElementById('profile-save-btn').dataset.photo = b64;
  });
  document.getElementById('profile-save-btn').addEventListener('click', async () => {
    const photo = document.getElementById('profile-save-btn').dataset.photo;
    if (!photo) return;
    await setDoc(doc(STATE.db, 'users', STATE.session.userId), { photoURL: photo }, { merge: true });
    document.getElementById('topbar-avatar').innerHTML = getAvatarHTML({ photoURL: photo, nickname: STATE.session.nickname }, 32);
    document.getElementById('profile-modal').style.display = 'none';
    showToast('Photo updated', 'success');
  });

  // Admin panel tabs
  document.querySelectorAll('#view-admin .tab-btn').forEach(btn =>
    btn.addEventListener('click', () => setAdminTab(btn.dataset.tab)));
  document.getElementById('admin-add-user-btn').addEventListener('click', addAdminUser);
  document.getElementById('fix-casing-btn').addEventListener('click', fixAllNameCasing);
  document.getElementById('recalc-match-btn').addEventListener('click', recalcMatch);
  document.getElementById('recalc-all-btn').addEventListener('click', recalcAll);
  document.getElementById('rescore-all-btn').addEventListener('click', rescoreAllMatches);
  document.getElementById('backdate-save-all-btn').addEventListener('click', saveAllBackdatePredictions);
  document.getElementById('run-audit-btn').addEventListener('click', runIntegrityAudit);

  // Leaderboard updated label click → refresh
  document.getElementById('leaderboard-updated').addEventListener('click', initLeaderboard);

  // Boot
  showView('view-login');
  initLoginView();
  const session = loadSession();
  if (session) { STATE.session = session; initApp(); }
});
