/* Kalibra — adaptive nutrition coach.
 * Everything is stored locally (localStorage). No account, no server.
 *
 * The core idea: the calorie target is derived from your *measured* energy expenditure, not a formula.
 * Every day we look back over up to 28 days, take your average logged intake and the slope of your
 * scale weight, and solve the energy balance equation:
 *     expenditure = average intake − (weight change per day × 7700 kcal/kg)
 * That raw estimate is noisy, so it is blended slowly into the running estimate (which starts from a
 * Mifflin-St Jeor / Katch-McArdle prior). Once a week a check-in turns the current expenditure and
 * your goal rate into new calorie and macro targets.
 */
(() => {
'use strict';

// ---------- constants ----------
const KEY = 'kalibra-v1';
const KCAL_PER_KG = 7700;          // energy density of body-mass change (≈3500 kcal/lb)
const WINDOW = 28;                 // look-back window for expenditure, days
const MIN_WINDOW = 10;             // days of history before the estimate starts moving
const GAIN = 0.12;                 // how fast the estimate follows new evidence (per day)
const MAX_STEP = 60;               // max change in expenditure per day, kcal
const TREND_ALPHA = 0.18;          // trend weight: level smoothing (Holt double-exponential)
const TREND_BETA = 0.025;          // trend weight: slope smoothing — removes the lag a plain moving average has
const LB = 2.2046226218;
const ACTIVITY = {
  sedentary: [1.2, 'Mostly sitting', 'Desk job, little walking, no training'],
  light: [1.375, 'Lightly active', 'On your feet some of the day or 1–3 workouts a week'],
  moderate: [1.55, 'Moderately active', 'Active job or 3–5 workouts a week'],
  very: [1.725, 'Very active', 'Hard training 6–7 days a week'],
  extreme: [1.9, 'Athlete', 'Physical job plus hard daily training'],
};
const DIETS = {
  balanced: ['Balanced', 'Carbs and fat split evenly after protein', 0.30],
  lowfat: ['Low fat', 'More room for carbs — good for high-volume training', 0.20],
  lowcarb: ['Low carb', 'Higher fat, carbs kept moderate', 0.45],
  keto: ['Keto', 'Carbs held around 25 g per day', null],
};
const PROTEIN = {
  moderate: ['Moderate', 1.6], high: ['High', 2.0], extra: ['Very high', 2.4],
};
const RATES = { lose: [0.25, 0.5, 0.75, 1.0], gain: [0.1, 0.25, 0.5] };
// Lean bulk (Jeff Nippard, "How To Bulk Like A Pro"): gain rate as % of body weight per month, by training age.
// [label, description, monthly rate options, default rate, default surplus]. Default surpluses per level are our choice inside the 5–10 % band.
const BULK = {
  beginner: ['Beginner', 'Less than about a year of consistent training', [1, 1.5, 2], 1.5, 0.10],
  intermediate: ['Intermediate', '1–3 years of consistent training', [0.5, 0.75, 1], 0.75, 0.075],
  advanced: ['Advanced', '3+ years, close to your natural limit', [0.5, 0.75, 1], 0.5, 0.05],
};
const LB_MULT = { sedentary: 14, light: 15, moderate: 16, very: 17, extreme: 18 }; // maintenance ≈ body weight (lb) × 14–18
const BULK_STEP = 150;      // max calorie change per bulk check-in
const BULK_DATA_DAYS = 14;  // days of usable logs before maintenance comes from your own data
const isBulk = g => (g || S.goal) && (g || S.goal).type === 'bulk';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- state ----------
const blank = () => ({
  v: 1, profile: null, goal: null, init: null,
  weights: {}, logs: {}, incomplete: {}, custom: [], recents: [], checkins: [],
  settings: { unit: 'kg', theme: 'auto', lang: defaultLang() },
  train: blankTrain(),
});
function defaultLang() { try { return /^sl\b/i.test(navigator.language || '') ? 'sl' : 'en'; } catch (e) { return 'en'; } }
function blankTrain() {
  return { templates: [], sessions: [], active: null, custom: [], days: [], shift: 0, rest: 120 };
}
const K = {};
let S = load();
let rev = 0;
const ui = { view: 'today', date: todayKey(), range: 90, ob: { step: 0 } };

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v) { const o = Object.assign(blank(), s); o.train = Object.assign(blankTrain(), s.train || {}); if (!o.settings.lang) o.settings.lang = defaultLang(); return o; } } catch (e) {}
  return blank();
}
function save() { rev++; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Storage is full — export a backup'); } }

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
const r0 = n => Math.round(n), r1 = n => Math.round(n * 10) / 10;
const isSl = () => S && S.settings && S.settings.lang === 'sl';
const fmt = n => { const t = Math.round(n).toLocaleString('en-US'); return isSl() ? t.replace(/,/g, '\u202f') : t; };
const loc = () => isSl() ? 'sl-SI' : 'en-GB';
const tt = s => window.KalI18n ? KalI18n.t(s) : s;  // translate text for dialogs (confirm / prompt)
const dayInitial = i => (isSl() ? 'NPTSČPS' : 'SMTWTFS')[i];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function todayKey() { return dkey(new Date()); }
function dkey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function pkey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = pkey(k); d.setDate(d.getDate() + n); return dkey(d); }
function diffDays(a, b) { return Math.round((pkey(b) - pkey(a)) / 864e5); }
function niceDate(k, long) {
  const t = todayKey();
  if (k === t) return 'Today';
  if (k === addDays(t, -1)) return 'Yesterday';
  if (k === addDays(t, 1)) return 'Tomorrow';
  return pkey(k).toLocaleDateString(loc(), long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
}
const unit = () => S.settings.unit;
const wDisp = kg => unit() === 'lb' ? kg * LB : kg;
const wIn = v => unit() === 'lb' ? v / LB : v;
const wFmt = (kg, d = 1) => kg == null || isNaN(kg) ? '—' : wDisp(kg).toFixed(d);
const age = () => new Date().getFullYear() - S.profile.birthYear;

const I = {
  plus: '<path d="M12 5v14M5 12h14"/>', left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  today: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', chart: '<path d="M3 17l5-5 4 4 8-8"/><path d="M14 8h6v6"/>',
  plan: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', scan: '<path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3M7 8v8M10 8v8M13 8v8M17 8v8"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  scale: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 9a5 5 0 018 0l-3 3"/>', copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  check: '<path d="M20 6L9 17l-5-5"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>',
};
Object.assign(I, {
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>',
  apple: '<path d="M12 7c-1.5-1.5-5-2-6.5 1S5 16 8 19c1.5 1.5 2.5 1 4 .5 1.5.5 2.5 1 4-.5 3-3 4-8 2.5-11S13.5 5.5 12 7z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>', trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 6h3v2a3 3 0 01-3 3M7 6H4v2a3 3 0 003 3"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3.5 2-4.5.5 1.5 1.5 2.5 2.5 2.5C11 8.5 11 5.5 12 3z"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>', minus: '<path d="M5 12h14"/>',
});
const icon = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;

let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

function applyTheme() {
  if (window.KalI18n) KalI18n.set(S.settings.lang);
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  try { t === 'auto' ? localStorage.removeItem('kal-theme') : localStorage.setItem('kal-theme', t); } catch (e) {}
}

// ---------- energy model ----------
function bmr(weightKg) {
  const p = S.profile;
  if (p.bodyFat) return 370 + 21.6 * weightKg * (1 - p.bodyFat / 100);          // Katch-McArdle
  return 10 * weightKg + 6.25 * p.heightCm - 5 * age() + (p.sex === 'male' ? 5 : -161); // Mifflin-St Jeor
}
const initialTDEE = w => bmr(w) * ACTIVITY[S.profile.activity][0];

function ols(pts) {
  const n = pts.length; if (n < 2) return 0;
  let sx = 0, sy = 0; for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n; let num_ = 0, den = 0;
  for (const [x, y] of pts) { num_ += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num_ / den : 0;
}

let memo = { rev: -1 };
function model() {
  if (memo.rev === rev && memo.today === todayKey()) return memo.out;
  const t = todayKey();
  let start = S.profile.start;
  const wk = Object.keys(S.weights).sort();
  const lk = Object.keys(S.logs).filter(k => S.logs[k].length).sort();
  if (wk[0] && wk[0] < start) start = wk[0];
  if (lk[0] && lk[0] < start) start = lk[0];
  const N = Math.max(1, diffDays(start, t) + 1);
  const days = [];
  for (let i = 0; i < N; i++) {
    const k = addDays(start, i);
    const items = S.logs[k] || [];
    const intake = items.length ? items.reduce((a, e) => a + e.kcal, 0) : null;
    days.push({ k, i, w: S.weights[k] ?? null, intake, complete: items.length > 0 && !S.incomplete[k] });
  }
  // interpolate scale weight between weigh-ins, then smooth into a trend
  const wi = days.filter(d => d.w != null).map(d => d.i);
  let trend = null, slope = 0;
  days.forEach(d => {
    let w;
    if (!wi.length) w = S.profile.startWeight;
    else if (d.i <= wi[0]) w = days[wi[0]].w;
    else if (d.i >= wi[wi.length - 1]) w = days[wi[wi.length - 1]].w;
    else {
      let j = 0; while (wi[j + 1] < d.i) j++;
      const a = wi[j], b = wi[j + 1];
      w = d.w != null ? d.w : days[a].w + (days[b].w - days[a].w) * (d.i - a) / (b - a);
    }
    d.wi = w;
    if (trend == null) trend = w;
    else { const prev = trend; trend = TREND_ALPHA * w + (1 - TREND_ALPHA) * (trend + slope); slope = TREND_BETA * (trend - prev) + (1 - TREND_BETA) * slope; }
    d.trend = trend;
  });
  // adaptive expenditure
  let E = S.init;
  let lastW = -1;
  days.forEach(d => {
    if (d.w != null) lastW = d.i;
    d.raw = null;
    const W = Math.min(WINDOW, d.i + 1);
    if (W >= MIN_WINDOW && lastW >= 0 && d.i - lastW <= 3) {
      const a = d.i - W + 1;
      const win = days.slice(a, d.i + 1);
      const wPts = win.filter(x => x.w != null).map(x => [x.i, x.w]);
      const eat = win.filter(x => x.complete).map(x => x.intake);
      const span = wPts.length ? wPts[wPts.length - 1][0] - wPts[0][0] : 0;
      if (wPts.length >= 3 && span >= 7 && eat.length >= Math.max(6, W * 0.5)) {
        const avg = eat.reduce((s, v) => s + v, 0) / eat.length;
        const raw = clamp(avg - ols(wPts) * KCAL_PER_KG, 900, 6500);
        d.raw = raw;
        E += clamp(GAIN * Math.min(1, W / 21) * (raw - E), -MAX_STEP, MAX_STEP);
      }
    }
    d.E = E;
  });
  const dataDays = days.filter(d => d.raw != null).length;
  memo = { rev, today: t, out: { days, start, dataDays, byKey: Object.fromEntries(days.map(d => [d.k, d])) } };
  return memo.out;
}
const latest = () => { const m = model(); return m.days[m.days.length - 1]; };

// ---------- targets ----------
function refWeight(w) {
  const h = S.profile.heightCm / 100;
  return Math.min(w, 25 * h * h); // cap protein reference weight at BMI 25 so it scales with lean mass
}
function macrosFor(kcal, w) {
  const g = S.goal, rw = refWeight(w);
  let p = r0(rw * PROTEIN[g.protein][1]);
  let f, c;
  if (g.diet === 'keto') {
    c = 25; f = (kcal - p * 4 - c * 4) / 9;
  } else {
    f = kcal * DIETS[g.diet][2] / 9;
    f = Math.max(f, 0.5 * rw);
    c = (kcal - p * 4 - f * 9) / 4;
    if (c < 0) { c = 0; f = (kcal - p * 4) / 9; }
  }
  return { p, c: Math.max(0, r0(c)), f: Math.max(0, r0(f)) };
}
function goalRateKgWeek(w) {
  const g = S.goal;
  if (g.type === 'maintain') return 0;
  if (g.type === 'bulk') return g.monthPct / 100 * w * 7 / 30.44;
  return (g.type === 'lose' ? -1 : 1) * g.ratePct / 100 * w;
}
function bulkMaint(E, w, dataDays) {
  return dataDays >= BULK_DATA_DAYS ? E : w * LB * LB_MULT[S.profile.activity];
}
function bulkMacros(kcal, w) {
  const g = S.goal;
  const p = r0(w * LB * (g.pLb || 0.85));          // 0.7–1.0 g per lb of body weight
  const f = r0(kcal * (g.fatPct || 0.25) / 9);     // 20–30 % of calories
  const c = Math.max(0, r0((kcal - p * 4 - f * 9) / 4)); // carbs fill the rest
  return { p, c, f };
}
function computeTargets(E, w, dataDays = 0) {
  const g = S.goal;
  if (g.mode === 'manual') return Object.assign({ manual: true }, g.manual);
  if (g.type === 'bulk') {
    const maint = bulkMaint(E, w, dataDays);
    const kcal = r0(maint * (1 + g.surplus) / 5) * 5;
    return Object.assign({ kcal, maint: r0(maint), bulk: true, fresh: true }, bulkMacros(kcal, w));
  }
  const floor = S.profile.sex === 'male' ? 1500 : 1200;
  let kcal = r0((E + goalRateKgWeek(w) * KCAL_PER_KG / 7) / 5) * 5;
  const floored = kcal < floor;
  if (floored) kcal = floor;
  return Object.assign({ kcal, floored }, macrosFor(kcal, w));
}
function baseTargetsOn(k) {
  if (S.goal.mode === 'manual') return S.goal.manual;
  let t = S.checkins[0];
  for (const c of S.checkins) if (c.date <= k) t = c;
  return t;
}
// Training-day calorie shifting: training days get extra calories (as carbs) and rest days give the same
// amount back, so the weekly total — and therefore the rate of progress — is unchanged.
function isTrainingDay(k) {
  const T = S.train;
  return T.days.includes(pkey(k).getDay()) || T.sessions.some(x => x.date === k) || (T.active && T.active.date === k);
}
function targetsOn(k) {
  const b = baseTargetsOn(k), T = S.train, n = T.days.length;
  if (!T.shift || n < 1 || n > 6) return b;
  const t = Object.assign({}, b), train = isTrainingDay(k);
  const delta = r0(b.kcal * T.shift / 5) * 5 * (train ? 1 : -n / (7 - n));
  t.kcal = r0(b.kcal + delta);
  t.c = b.c + delta / 4;
  if (t.c < 0) { t.f = Math.max(0, b.f + (t.c * 4) / 9); t.c = 0; }
  t.c = r0(t.c); t.f = r0(t.f); t.train = train; t.delta = r0(delta);
  return t;
}
function nextCheckin() {
  const last = S.checkins[S.checkins.length - 1];
  let k = addDays(last.date, 1);
  while (pkey(k).getDay() !== S.goal.checkinDay) k = addDays(k, 1);
  if (diffDays(last.date, k) < 4) k = addDays(k, 7);
  return k;
}
const checkinDue = () => S.goal.mode !== 'manual' && todayKey() >= nextCheckin();
function previewCheckin(fresh) {
  const m = model(), d = latest();
  const prev = S.checkins[S.checkins.length - 1];
  const wkAgo = m.byKey[addDays(d.k, -7)];
  const last7 = m.days.slice(-8, -1).filter(x => x.complete);
  const weighIns = m.days.slice(-7).filter(x => x.w != null).length;
  const out = {
    date: d.k, E: r0(d.E), trend: r1(d.trend),
    trendChange: wkAgo ? d.trend - wkAgo.trend : null,
    avgIntake: last7.length ? r0(last7.reduce((a, x) => a + x.intake, 0) / last7.length) : null,
    logged: last7.length, weighIns, prev, dataDays: m.dataDays, ...computeTargets(d.E, d.trend, m.dataDays),
  };
  // Lean bulk: after the first week, steer calories by comparing trend gain with the target gain.
  if (isBulk() && S.goal.mode !== 'manual' && !fresh && prev && prev.bulk && prev.date !== d.k) {
    const target = goalRateKgWeek(d.trend);
    out.targetGain = target; out.fresh = false;
    if (out.trendChange == null || weighIns < 3) {
      out.adj = 0; out.kcal = prev.kcal;
      out.why = 'Not enough weigh-ins this week to judge your gain, so calories stay the same. Weigh in at least 3 mornings a week.';
    } else {
      const raw = (target - out.trendChange) * KCAL_PER_KG / 7;
      out.adj = r0(clamp(raw, -BULK_STEP, BULK_STEP) / 5) * 5;
      out.kcal = prev.kcal + out.adj;
      const gain = `${out.trendChange >= 0 ? '+' : '−'}${Math.abs(wDisp(out.trendChange)).toFixed(2)} ${unit()}`, tgt = `+${wDisp(target).toFixed(2)} ${unit()}`;
      out.why = Math.abs(out.adj) < 5 ? `Your trend changed ${gain} this week against a target of ${tgt}. Right on pace, so calories stay the same.`
        : out.adj > 0 ? `Your trend changed ${gain} this week, slower than the target of ${tgt}. Calories go up ${out.adj} kcal${Math.abs(raw) > BULK_STEP ? ' (the most allowed in one week)' : ''}.`
        : `Your trend changed ${gain} this week, faster than the target of ${tgt}. Faster gain mostly adds fat, so calories go down ${-out.adj} kcal${Math.abs(raw) > BULK_STEP ? ' (the most allowed in one week)' : ''}.`;
    }
    Object.assign(out, bulkMacros(out.kcal, d.trend));
  }
  return out;
}
function applyCheckin(fresh) {
  const c = previewCheckin(fresh);
  const rec = { date: c.date, E: c.E, trend: c.trend, kcal: c.kcal, p: c.p, c: c.c, f: c.f };
  if (c.bulk) Object.assign(rec, { bulk: true, maint: c.maint, adj: c.adj ?? null, gain: c.trendChange, why: c.why || null });
  S.checkins = S.checkins.filter(x => x.date !== c.date).concat(rec).sort((a, b) => a.date < b.date ? -1 : 1);
  save();
}

// ---------- day helpers ----------
function dayTotals(k) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0 };
  for (const e of S.logs[k] || []) { t.kcal += e.kcal; t.p += e.p; t.c += e.c; t.f += e.f; t.fib += e.fib || 0; }
  return t;
}
function nutrFor(per100, grams) {
  const m = grams / 100;
  return { kcal: per100.kcal * m, p: per100.p * m, c: per100.c * m, f: per100.f * m, fib: (per100.fib || 0) * m };
}
function rememberRecent(food) {
  const key = food.src + ':' + (food.id || food.name);
  S.recents = [Object.assign({}, food, { rk: key })].concat(S.recents.filter(r => r.rk !== key)).slice(0, 40);
}

// ---------- foods ----------
const ALIASES = Object.entries(window.KAL_FOOD_ALIASES || {});
const DB = (window.KAL_FOODS || []).map((r, i) => ({
  src: 'db', id: 'db' + i, name: r[0], cat: r[1], brand: r[8] === 't' ? 'Typical values' : 'USDA', typical: r[8] === 't',
  alias: ALIASES.filter(([k]) => r[0].includes(k)).map(([, v]) => v).join(' '),
  per100: { kcal: r[2], p: r[3], c: r[4], f: r[5], fib: r[6] },
  servings: r[7] ? r[7].split(';').map(s => { const j = s.lastIndexOf(':'); return { label: s.slice(0, j), g: +s.slice(j + 1) }; }) : [],
}));
function searchLocal(q) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = S.custom.concat(DB);
  if (!toks.length) return pool;
  return pool.map(f => {
    const n = (f.name + ' ' + (f.brand || '') + ' ' + (f.cat || '') + ' ' + (f.alias || '')).toLowerCase();
    if (!toks.every(t => n.includes(t))) return null;
    return [f, (f.name.toLowerCase().startsWith(toks[0]) ? 0 : 1) + (f.src === 'custom' ? -0.5 : 0) + (f.typical ? 0.6 : 0)];
  }).filter(Boolean).sort((a, b) => a[1] - b[1] || a[0].name.length - b[0].name.length).map(x => x[0]);
}
function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n.energy_100g != null) kcal = n.energy_100g / 4.184;
  if (kcal == null) return null;
  const sq = num(p.serving_quantity);
  return {
    src: 'off', id: p.code, code: p.code, name: p.product_name || p.product_name_en || 'Unnamed product', brand: (p.brands || '').split(',')[0],
    per100: { kcal: +kcal || 0, p: +n.proteins_100g || 0, c: +n.carbohydrates_100g || 0, f: +n.fat_100g || 0, fib: +n.fiber_100g || 0 },
    servings: sq > 0 ? [{ label: p.serving_size ? '1 serving (' + p.serving_size + ')' : '1 serving', g: sq }] : [],
  };
}
const OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_quantity,serving_size';
async function offSearch(q) {
  const u = 'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=25&fields=' + OFF_FIELDS + '&search_terms=' + encodeURIComponent(q);
  const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.products || []).map(offToFood).filter(Boolean);
}
async function offBarcode(code) {
  const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=' + OFF_FIELDS);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return j.status === 1 && j.product ? offToFood(Object.assign({ code }, j.product)) : null;
}

// ---------- charts ----------
function chart({ w = 340, h = 180, series, xMin, xMax, yMin, yMax, xLabels = [], yStep, bars }) {
  const L = 34, R = 6, T = 8, B = 20;
  const pw = w - L - R, ph = h - T - B;
  if (yMax - yMin < 1e-6) { yMax += 1; yMin -= 1; }
  const X = x => L + (xMax === xMin ? pw / 2 : (x - xMin) / (xMax - xMin) * pw);
  const Y = y => T + (1 - (y - yMin) / (yMax - yMin)) * ph;
  let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img">`;
  const step = yStep || niceStep((yMax - yMin) / 4);
  for (let v = Math.ceil(yMin / step) * step; v <= yMax + 1e-9; v += step) {
    s += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/>`;
    s += `<text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${step < 1 ? v.toFixed(1) : fmt(v)}</text>`;
  }
  xLabels.forEach(([x, t]) => { s += `<text x="${X(x)}" y="${h - 4}" text-anchor="middle">${esc(t)}</text>`; });
  if (bars) {
    const bw = Math.max(1.5, pw / (xMax - xMin + 1) * 0.7);
    bars.pts.forEach(([x, y, col]) => { s += `<rect x="${X(x) - bw / 2}" y="${Y(y)}" width="${bw}" height="${Math.max(0, Y(yMin) - Y(y))}" rx="${Math.min(3, bw / 2)}" fill="${col || bars.color}" opacity="${bars.opacity || 1}"/>`; });
  }
  series.forEach(sr => {
    if (sr.dots) sr.pts.forEach(([x, y]) => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="${sr.r || 2.6}" fill="${sr.color}" opacity="${sr.opacity || 1}"/>`; });
    else if (sr.pts.length) {
      const d = sr.pts.map(([x, y], i) => (i ? 'L' : 'M') + X(x).toFixed(1) + ' ' + Y(y).toFixed(1)).join('');
      s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="${sr.width || 2.5}" stroke-linejoin="round" stroke-linecap="round" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ''}/>`;
    }
  });
  return s + '</svg>';
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function xLabelsFor(days, i0, i1) {
  const span = i1 - i0, out = [], n = 4;
  for (let j = 0; j <= n; j++) { const i = Math.round(i0 + span * j / n); if (days[i]) out.push([i, pkey(days[i].k).toLocaleDateString(loc(), { day: 'numeric', month: 'short' })]); }
  return out;
}

// ---------- sheets ----------
let sheetStack = [];
function openSheet(title, body, opts = {}) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  const el = document.createElement('section');
  el.className = 'sheet' + (opts.full ? ' full' : '');
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title);
  el.innerHTML = `<div class="grab"></div><div class="sheet-h"><h2>${esc(title)}</h2><button class="icon-btn" data-act="close" aria-label="Close">${icon('x')}</button></div><div class="sheet-b">${body}</div>`;
  document.body.append(scrim, el);
  scrim.onclick = closeSheet;
  requestAnimationFrame(() => { scrim.classList.add('on'); el.classList.add('on'); });
  sheetStack.push({ el, scrim, onClose: opts.onClose });
  dragToDismiss(el, scrim);
  const f = el.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 320);
  return el;
}
function closeSheet() {
  const s = sheetStack.pop(); if (!s) return;
  s.el.style.transform = ''; s.el.classList.remove('on'); s.scrim.classList.remove('on');
  setTimeout(() => { s.el.remove(); s.scrim.remove(); }, 380);
  if (s.onClose) s.onClose();
}
// Pull a sheet down by its handle or header to close it.
function dragToDismiss(el, scrim) {
  let y0 = null, dy = 0, t0 = 0;
  const zone = e => e.target.closest('.grab, .sheet-h') && !e.target.closest('button, input, select');
  el.addEventListener('pointerdown', e => {
    if (!zone(e)) return;
    y0 = e.clientY; dy = 0; t0 = performance.now();
    el.classList.add('dragging'); el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    el.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / 500));
  });
  const end = () => {
    if (y0 == null) return;
    const v = dy / Math.max(1, performance.now() - t0);
    y0 = null; el.classList.remove('dragging'); scrim.style.opacity = '';
    if (dy > 140 || v > 0.6) { if (sheetStack.length && sheetStack[sheetStack.length - 1].el === el) closeSheet(); }
    else el.style.transform = '';
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function closeAll() { while (sheetStack.length) closeSheet(); }
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ---------- onboarding ----------
const OB_STEPS = 7;
function renderOnboarding() {
  applyTheme();
  const o = ui.ob, st = o.step;
  const d = o.d || (o.d = { unit: 'kg', sex: 'female', birthYear: '', height: '', ft: '', inch: '', weight: '', bodyFat: '', activity: 'light', type: 'lose', ratePct: 0.5, target: '', diet: 'balanced', protein: 'high', exp: 'intermediate', monthPct: 0.75, pLb: 0.85, fatPct: 0.25 });
  const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-act="ob-set" data-k="${k}" data-v="${v}" aria-pressed="${d[k] === v}">${l}</button>`).join('')}</div>`;
  const ch = (k, v, title, sub) => `<button type="button" class="choice" data-act="ob-set" data-k="${k}" data-v="${v}" aria-pressed="${String(d[k]) === String(v)}"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</button>`;
  const inp = (k, ph, mode = 'decimal') => `<input class="input" inputmode="${mode}" data-ob="${k}" value="${esc(d[k])}" placeholder="${ph}">`;
  let body = '', next = 'Continue';
  const u = d.unit;
  if (st === 0) {
    body = `<div class="wordmark" style="margin-top:12vh">Kalibra</div>
      <h1 style="margin-top:18px">Targets that learn from your real metabolism.</h1>
      <p class="lead">Log what you eat and weigh in most mornings. Each week Kalibra measures how much energy you actually burn and adjusts your calories and macros to keep you on pace.</p>
      <p class="note">Setup takes about a minute. Your data stays on this device.</p>
      <div class="seg" style="margin-top:24px;max-width:280px">${[['en', 'English'], ['sl', 'Slovenščina']].map(([v, l]) => `<button type="button" data-act="ob-lang" data-v="${v}" aria-pressed="${S.settings.lang === v}">${l}</button>`).join('')}</div>`;
    next = 'Get started';
  } else if (st === 1) {
    body = `<h1>About you</h1><p class="lead">Used for your starting estimate. Your own data takes over after 2–3 weeks.</p>
      <label class="field"><span>Units</span>${seg('unit', [['kg', 'kg · cm'], ['lb', 'lb · ft']])}</label>
      <label class="field"><span>Sex</span>${seg('sex', [['female', 'Female'], ['male', 'Male']])}</label>
      <label class="field"><span>Year of birth</span>${inp('birthYear', 'e.g. 1992', 'numeric')}</label>`;
  } else if (st === 2) {
    body = `<h1>Body</h1><p class="lead">Weigh yourself in the morning, after the bathroom, before eating.</p>
      ${u === 'kg' ? `<label class="field"><span>Height (cm)</span>${inp('height', 'e.g. 178')}</label>`
        : `<div class="grid2"><label class="field"><span>Height (ft)</span>${inp('ft', '5', 'numeric')}</label><label class="field"><span>(in)</span>${inp('inch', '10')}</label></div>`}
      <label class="field"><span>Current weight (${u})</span>${inp('weight', u === 'kg' ? 'e.g. 82.4' : 'e.g. 181.6')}</label>
      <label class="field"><span>Body fat % (optional)</span>${inp('bodyFat', 'Leave blank if unsure')}</label>
      <p class="note">Only fill in body fat if it comes from a DEXA scan or a reliable method — a wrong number hurts more than none.</p>`;
  } else if (st === 3) {
    body = `<h1>Daily activity</h1><p class="lead">Pick what fits a normal week, including training.</p>
      ${Object.entries(ACTIVITY).map(([k, a]) => ch('activity', k, a[1], a[2])).join('')}`;
  } else if (st === 4) {
    const w = num(d.weight), wk = wIn(w);
    const by = new Date().getFullYear() - (+d.birthYear || 0);
    body = `<h1>Your goal</h1><p class="lead">${d.type === 'bulk' ? 'A lean bulk gains weight slowly on purpose. How fast depends on how long you have trained.' : 'Rate is set as a percentage of body weight per week, so it scales as you change.'}</p>
      <div class="field">${seg('type', [['lose', 'Lose fat'], ['maintain', 'Maintain'], ['bulk', 'Lean bulk']])}</div>
      ${d.type === 'maintain' ? '<p class="note">Calories will track your expenditure so your weight stays stable.</p>' : d.type === 'bulk' ? `
        <label class="field"><span>Training experience</span></label>${Object.entries(BULK).map(([k, b]) => ch('exp', k, b[0], b[1])).join('')}
        <label class="field"><span>Target gain per month</span>${seg('monthPct', BULK[d.exp][2].map(r => [r, r + '%']))}</label>
        <p class="note">${isFinite(wk) ? `≈ ${wDisp(wk * d.monthPct / 100).toFixed(2)} ${u} per month. ` : ''}${d.exp === 'beginner' ? 'Beginners can build muscle fast, so 1–2 % a month is mostly lean mass.' : 'Muscle can’t be force-fed. Near your limit, gaining faster than 0.5–1 % a month mostly adds fat.'}</p>
        ${by && by < 18 ? '<p class="note" style="color:var(--over)">Under 18? Talk to a doctor or dietitian before bulking.</p>' : ''}` :
        `<label class="field"><span>Weekly rate</span></label>${RATES[d.type].map(r => ch('ratePct', r, `${r}% per week`, isFinite(wk) ? `≈ ${(wDisp(wk) * r / 100).toFixed(2)} ${u} per week · ${fmt(wk * r / 100 * KCAL_PER_KG / 7)} kcal/day ${d.type === 'lose' ? 'deficit' : 'surplus'}` : '')).join('')}
         <label class="field"><span>Goal weight (${u}, optional)</span>${inp('target', '')}</label>`}`;
  } else if (st === 5 && d.type === 'bulk') {
    body = `<h1>Your macros</h1><p class="lead">Set in this order: protein first, then fat, and carbs fill the rest.</p>
      <label class="field"><span>Protein, grams per lb of body weight</span>${seg('pLb', [[0.7, '0.7 g'], [0.85, '0.85 g'], [1, '1.0 g']])}</label>
      <p class="note">0.7–1 g per lb (1.6–2.2 g/kg) covers muscle growth. 0.85 g is a solid middle.</p>
      <label class="field"><span>Fat share of calories</span>${seg('fatPct', [[0.2, '20%'], [0.25, '25%'], [0.3, '30%']])}</label>
      <p class="note">Too little fat can lower testosterone; too much is stored as body fat more easily than carbs.</p>`;
  } else if (st === 5) {
    body = `<h1>How you like to eat</h1>
      <label class="field"><span>Diet style</span></label>${Object.entries(DIETS).map(([k, x]) => ch('diet', k, x[0], x[1])).join('')}
      <label class="field"><span>Protein</span>${seg('protein', Object.entries(PROTEIN).map(([k, x]) => [k, x[0]]))}</label>
      <p class="note">Moderate 1.6, high 2.0, very high 2.4 g per kg. Above a BMI of 25 it is based on a lean reference weight instead.</p>`;
  } else if (st === 6) {
    const p = buildProfile(d);
    const prev = S.profile, prevG = S.goal;
    S.profile = p.profile; S.goal = p.goal;
    const E = p.goal.type === 'bulk' ? p.profile.startWeight * LB * LB_MULT[p.profile.activity] : initialTDEE(p.profile.startWeight);
    const t = computeTargets(E, p.profile.startWeight);
    S.profile = prev; S.goal = prevG;
    body = `<h1>Your starting plan</h1><p class="lead">This is an educated guess. Log consistently and the weekly check-in will correct it to your real numbers.</p>
      <div class="hero"><div class="big num">${fmt(t.kcal)}</div><div class="big-l">kcal per day</div>
      <div class="macros">${macroStatic('Protein', t.p, 'var(--pro)')}${macroStatic('Carbs', t.c, 'var(--carb)')}${macroStatic('Fat', t.f, 'var(--fat)')}</div></div>
      <div class="card"><div class="kv"><span>${p.goal.type === 'bulk' ? 'Estimated maintenance' : 'Estimated expenditure'}</span><b>${fmt(t.maint || E)} kcal</b></div>
      ${p.goal.type === 'bulk' ? `<div class="kv"><span>Surplus</span><b>+${r0(p.goal.surplus * 100 * 10) / 10}% · +${fmt(t.kcal - t.maint)} kcal</b></div>` : ''}
      <div class="kv"><span>Goal</span><b>${goalLabel(p.goal)}</b></div>
      <div class="kv"><span>Check-in</span><b>Every ${DAYS[p.goal.checkinDay]}</b></div></div>
      ${t.floored ? '<p class="note">Your target was raised to a safe minimum. Consider a slower rate.</p>' : ''}`;
    next = 'Start tracking';
  }
  $('#app').innerHTML = `<main class="ob">
    <div class="ob-prog" aria-hidden="true">${Array.from({ length: OB_STEPS - 1 }, (_, i) => `<i class="${i < st ? 'on' : ''}"></i>`).join('')}</div>
    <div class="ob-body">${body}<p class="note" id="ob-err" style="color:var(--over)"></p></div>
    <div class="ob-foot">${st ? '<button class="btn ghost" data-act="ob-back">Back</button>' : ''}<button class="btn" data-act="ob-next">${next}</button></div></main>`;
}
const macroStatic = (l, g, c) => `<div class="macro"><div class="lbl"><i class="dot" style="background:${c}"></i>${l}</div><div class="val num">${g}<small> g</small></div></div>`;
function buildProfile(d) {
  const lb = d.unit === 'lb';
  const heightCm = lb ? (num(d.ft) * 12 + (num(d.inch) || 0)) * 2.54 : num(d.height);
  const w = lb ? num(d.weight) / LB : num(d.weight);
  const t = num(d.target);
  return {
    profile: { sex: d.sex, birthYear: +d.birthYear, heightCm, startWeight: w, bodyFat: num(d.bodyFat) > 3 ? num(d.bodyFat) : null, activity: d.activity, start: todayKey() },
    goal: { mode: 'coached', type: d.type, ratePct: d.type === 'lose' || d.type === 'gain' ? +d.ratePct : 0, exp: d.exp, monthPct: +d.monthPct, surplus: BULK[d.exp][4], pLb: +d.pLb, fatPct: +d.fatPct, target: isFinite(t) ? (lb ? t / LB : t) : null, diet: d.diet, protein: d.protein, checkinDay: pkey(todayKey()).getDay(), manual: null },
  };
}
function validateStep() {
  const d = ui.ob.d, st = ui.ob.step, y = new Date().getFullYear();
  if (st === 1 && !(+d.birthYear > y - 100 && +d.birthYear <= y - 13)) return 'Enter a year of birth (age 13 or older).';
  if (st === 2) {
    const p = buildProfile(d).profile;
    if (!(p.heightCm > 120 && p.heightCm < 240)) return 'Enter your height.';
    if (!(p.startWeight > 30 && p.startWeight < 300)) return 'Enter your current weight.';
  }
  return '';
}
function finishOnboarding() {
  const p = buildProfile(ui.ob.d);
  S.settings.unit = ui.ob.d.unit;
  S.profile = p.profile; S.goal = p.goal;
  S.init = r0(p.goal.type === 'bulk' ? p.profile.startWeight * LB * LB_MULT[p.profile.activity] : initialTDEE(p.profile.startWeight));
  S.weights[todayKey()] = r1(p.profile.startWeight * 10) / 10;
  S.checkins = [];
  const t = computeTargets(S.init, p.profile.startWeight);
  S.checkins.push({ date: todayKey(), E: S.init, trend: p.profile.startWeight, kcal: t.kcal, p: t.p, c: t.c, f: t.f, initial: true, bulk: !!t.bulk, maint: t.maint });
  save(); ui.view = 'today'; render();
}
function goalLabel(g) {
  if (g.mode === 'manual') return 'Manual targets';
  if (g.type === 'maintain') return 'Maintain weight';
  if (g.type === 'bulk') return 'Lean bulk +' + g.monthPct + '% / month';
  return (g.type === 'lose' ? 'Lose ' : 'Gain ') + g.ratePct + '% / week';
}

// ---------- main views ----------
const ORDER = ['today', 'train', 'progress', 'plan', 'profile'];
const VIEWS = {};
queueMicrotask(() => Object.assign(VIEWS, { today: viewToday, progress: viewProgress, plan: viewPlan, profile: viewProfile }));
const TITLES = { train: 'Train', progress: 'Progress', plan: 'Plan', profile: 'You' };
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function ensureShell() {
  if ($('#main')) return;
  const tab = (id, ic, l) => `<button class="tab" data-act="view" data-v="${id}">${icon(ic)}<span>${l}</span></button>`;
  $('#app').innerHTML = `<header class="top" id="top"></header><main class="wrap" id="main"></main>
    <nav class="tabbar" aria-label="Main"><div class="tabbar-in"><i class="tab-ind" aria-hidden="true"></i>
      ${tab('today', 'today', 'Today')}${tab('train', 'dumbbell', 'Train')}
      <button class="fab" data-act="fab" aria-label="Add" aria-expanded="false">${icon('plus')}</button>
      ${tab('progress', 'chart', 'Progress')}${tab('plan', 'plan', 'Plan')}</div></nav>`;
}
function header(v) {
  const lang = `<button class="lang-btn" data-act="toggle-lang" aria-label="Change language">${icon('globe')}<span>${isSl() ? 'SL' : 'EN'}</span></button>`;
  const me = lang + `<button class="icon-btn" data-act="view" data-v="profile" aria-label="Profile and settings">${icon('user')}</button>`;
  if (v === 'today') return `<div class="top-in"><h1 class="num">${esc(niceDate(ui.date, true))}</h1><div class="datenav"><button data-act="day" data-n="-1" aria-label="Previous day">${icon('left')}</button><span>${pkey(ui.date).toLocaleDateString(loc(), { day: 'numeric', month: 'short' })}</span><button data-act="day" data-n="1" aria-label="Next day">${icon('right')}</button></div>${me}</div>`;
  return `<div class="top-in"><h1>${TITLES[v]}</h1>${v === 'profile' ? lang : me}</div>`;
}
function render() {
  applyTheme();
  if (!S.profile) { renderOnboarding(); return; }
  ensureShell();
  const v = ui.view;
  $('#top').innerHTML = header(v);
  const main = $('#main'), sig = v + '|' + (v === 'today' ? ui.date : '');
  main.classList.toggle('stagger', main.dataset.sig !== sig);
  main.dataset.sig = sig;
  main.innerHTML = VIEWS[v]();
  document.querySelectorAll('.tab').forEach(b => b.dataset.v === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  const slot = { today: 0, train: 1, progress: 3, plan: 4 }[v];
  const ind = $('.tab-ind');
  ind.style.opacity = slot == null ? '0' : '1';
  if (slot != null) ind.style.setProperty('--i', slot);
  animateIn($('#main'));
}
// Animated navigation between views (View Transitions API, with a CSS fallback).
function transition(fn, dir) {
  document.documentElement.dataset.dir = dir < 0 ? 'back' : 'fwd';
  if (document.startViewTransition && !reduceMotion()) { document.startViewTransition(fn); return; }
  fn();
  const m = $('#main'); if (!m || m.classList.contains('stagger')) return;
  m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter');
}
function go(view) {
  if (view === ui.view) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const dir = ORDER.indexOf(view) >= ORDER.indexOf(ui.view) ? 1 : -1;
  transition(() => { ui.view = view; render(); scrollTo(0, 0); }, dir);
}
// Count-up numbers and growing bars. Values animate from what was last shown, so updates feel continuous.
const shown = {};
function animateIn(root) {
  const still = reduceMotion();
  root.querySelectorAll('[data-count]').forEach(el => {
    const key = el.dataset.k, to = +el.dataset.count, dec = +(el.dataset.dec || 0);
    const from = key in shown ? shown[key] : (still ? to : 0);
    shown[key] = to;
    const out = v => dec ? v.toFixed(dec) : fmt(v);
    if (from === to || still) { el.textContent = out(to); return; }
    const t0 = performance.now(), D = 750;
    const step = now => {
      const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 4);
      el.textContent = out(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = out(from); requestAnimationFrame(step);
  });
  root.querySelectorAll('[data-w]').forEach(el => {
    const key = el.dataset.k, to = +el.dataset.w;
    const from = key in shown ? shown[key] : 0;
    shown[key] = to;
    if (still) { el.style.width = to + '%'; return; }
    el.style.transition = 'none'; el.style.width = from + '%'; void el.offsetWidth;
    el.style.transition = ''; requestAnimationFrame(() => { el.style.width = to + '%'; });
  });
}
const cnt = (k, v, dec = 0) => `<span data-count="${v}" data-k="${k}" data-dec="${dec}">${dec ? (+v).toFixed(dec) : fmt(v)}</span>`;
const barW = (k, pct, color, cls = '') => `<i class="${cls}" data-w="${clamp(pct, 0, 100)}" data-k="${k}" style="${color ? 'background:' + color : ''}"></i>`;

// Speed-dial menu on the + button.
function toggleFab(open) {
  const fab = $('.fab'); if (!fab) return;
  open = open ?? fab.getAttribute('aria-expanded') !== 'true';
  fab.setAttribute('aria-expanded', String(open));
  let m = $('#dial');
  if (!open) { if (m) { m.classList.remove('on'); setTimeout(() => m.remove(), 260); } return; }
  const act = S.train.active;
  m = document.createElement('div'); m.id = 'dial'; m.className = 'dial';
  m.innerHTML = `<div class="dial-scrim" data-act="fab-close"></div><div class="dial-list">
    <button class="dial-btn" data-act="dial" data-v="food" style="--d:2">${icon('apple')}<span>Log food</span></button>
    <button class="dial-btn" data-act="dial" data-v="weight" style="--d:1">${icon('scale')}<span>Log weight</span></button>
    <button class="dial-btn" data-act="dial" data-v="workout" style="--d:0">${icon('dumbbell')}<span>${act ? 'Resume workout' : 'Start workout'}</span></button></div>`;
  document.body.append(m);
  requestAnimationFrame(() => m.classList.add('on'));
}

function viewToday() {
  const k = ui.date, t = targetsOn(k), tot = dayTotals(k), m = model();
  const d = m.byKey[k] || latest();
  const left = t.kcal - tot.kcal, over = left < 0;
  const pct = x => clamp(x / Math.max(t.kcal, 1) * 100, 0, 100);
  const pw = pct(tot.p * 4), cw = Math.min(pct(tot.c * 4), 100 - pw), fw = Math.min(pct(tot.f * 9), 100 - pw - cw);
  const mac = (key, l, eaten, target, c) => {
    const rem = target - eaten;
    return `<div class="macro"><div class="lbl"><i class="dot" style="background:${c}"></i>${l}</div>
      <div class="val num">${cnt('m' + key, r0(eaten))}<small> / ${target} g</small></div>
      <div class="bar">${barW('b' + key, eaten / Math.max(target, 1) * 100, c)}</div>
      <div class="sub">${rem >= 0 ? r0(rem) + ' g left' : r0(-rem) + ' g over'}</div></div>`;
  };
  const items = (S.logs[k] || []).slice().sort((a, b) => a.t - b.t);
  const scale = S.weights[k];
  const isToday = k === todayKey();
  let banner = '';
  if (isToday && checkinDue()) banner = `<button class="banner" data-act="checkin">${icon('check')}<div><b>Your weekly check-in is ready</b><span>Review last week and update your targets</span></div>${icon('right')}</button>`;
  else if (isToday && scale == null) banner = `<button class="banner soft" data-act="weight">${icon('scale')}<div><b>Log this morning's weight</b><span>Daily weigh-ins make your expenditure estimate sharper</span></div>${icon('right')}</button>`;
  const dayTag = t.delta ? `<span class="tag ${t.train ? 'on' : ''}">${t.train ? icon('dumbbell') + 'Training +' + fmt(t.delta) : 'Rest day −' + fmt(-t.delta)}</span>` : '';
  return `${banner}
  <section class="hero" aria-label="Calories">
    <div class="hero-row">
      <div><div class="big num ${over ? 'over' : ''}">${cnt('left', Math.abs(left))}</div><div class="big-l">${over ? 'kcal over target' : 'kcal left today'}</div></div>
      <div class="hero-side">${dayTag}<div>Eaten <b class="num">${cnt('eaten', tot.kcal)}</b></div><div>Target <b class="num">${fmt(t.kcal)}</b></div></div>
    </div>
    <div class="gauge" role="img" aria-label="${fmt(tot.kcal)} of ${fmt(t.kcal)} kcal">${barW('gp', pw, '', 'g-p')}${barW('gc', cw, '', 'g-c')}${barW('gf', fw, '', 'g-f')}</div>
    <div class="macros">${mac('p', 'Protein', tot.p, t.p, 'var(--pro)')}${mac('c', 'Carbs', tot.c, t.c, 'var(--carb)')}${mac('f', 'Fat', tot.f, t.f, 'var(--fat)')}</div>
  </section>
  <div class="stats">
    <button class="stat" data-act="weight"><div class="k">Scale</div><div class="v num">${scale != null ? cnt('scale', wDisp(scale), 1) : '+'}<small> ${scale != null ? unit() : 'log'}</small></div></button>
    <button class="stat" data-act="view" data-v="progress"><div class="k">Trend</div><div class="v num">${cnt('trend', wDisp(d.trend), 1)}<small> ${unit()}</small></div></button>
    <button class="stat" data-act="view" data-v="progress"><div class="k">Expenditure</div><div class="v num">${cnt('exp', r0(d.E))}<small> kcal</small></div></button>
  </div>
  ${K.trainingCard ? K.trainingCard(k) : ''}
  <section class="card">
    <div class="card-h"><h2>Food log</h2><span class="mute num" style="font-size:13px">Fiber ${r0(tot.fib)} g</span></div>
    ${items.length ? items.map(e => `<button class="entry" data-act="edit-entry" data-id="${e.id}">
        <span class="t">${new Date(e.t).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="n"><b>${esc(e.name)}</b><span>${esc(e.amountLabel || '')}</span>
          <span class="pm"><em style="color:var(--pro)">P ${r0(e.p)}</em><em style="color:var(--carb)">C ${r0(e.c)}</em><em style="color:var(--fat)">F ${r0(e.f)}</em></span></span>
        <span class="k num">${fmt(e.kcal)}</span></button>`).join('')
      : `<div class="empty"><b>Nothing logged ${isToday ? 'yet today' : 'on this day'}</b>Tap + to search, scan a barcode or quick-add calories.</div>`}
    <div class="row-btns">
      <button class="btn sm" data-act="food">${icon('plus')}Add food</button>
      <button class="btn sm ghost" data-act="copy-day">${icon('copy')}Copy previous day</button>
    </div>
    ${items.length ? `<p class="note">${S.incomplete[k]
      ? 'This day is marked as <b>incomplete</b>, so it is left out of your expenditure estimate. <a class="link" data-act="toggle-complete">Mark as complete</a>'
      : 'Forgot to log something? <a class="link" data-act="toggle-complete">Mark day as incomplete</a> so it doesn’t skew your expenditure.'}</p>` : ''}
  </section>`;
}

function viewProgress() {
  const m = model(), days = m.days;
  const i1 = days.length - 1, i0 = Math.max(0, i1 - ui.range + 1);
  const span = days.slice(i0);
  const rangeBtns = [[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y'], [9999, 'All']]
    .map(([n, l]) => `<button data-act="range" data-n="${n}" aria-pressed="${ui.range === n}">${l}</button>`).join('');
  const xl = xLabelsFor(days, i0, i1);
  // weight
  const wPts = span.filter(d => d.w != null).map(d => [d.i, wDisp(d.w)]);
  const tPts = span.map(d => [d.i, wDisp(d.trend)]);
  const allY = wPts.concat(tPts).map(p => p[1]);
  const pad = Math.max(0.5, (Math.max(...allY) - Math.min(...allY)) * 0.12);
  const wChart = chart({ series: [{ pts: wPts, dots: true, color: 'var(--mute)', opacity: .55 }, { pts: tPts, color: 'var(--brand)', width: 3 }], xMin: i0, xMax: i1, yMin: Math.min(...allY) - pad, yMax: Math.max(...allY) + pad, xLabels: xl });
  const last = days[i1], first = days[i0];
  const wk = days[Math.max(0, i1 - 7)];
  const ch = last.trend - first.trend, wkRate = last.trend - wk.trend;
  // expenditure
  const ePts = span.map(d => [d.i, d.E]);
  const eY = ePts.map(p => p[1]);
  const eChart = chart({ series: [{ pts: ePts, color: 'var(--ink)', width: 3 }], xMin: i0, xMax: i1, yMin: Math.min(...eY) - 100, yMax: Math.max(...eY) + 100, xLabels: xl });
  // intake
  const bars = span.filter(d => d.intake != null).map(d => [d.i, d.intake, d.complete ? 'var(--brand)' : 'var(--line)']);
  const tgt = span.map(d => [d.i, targetsOn(d.k).kcal]);
  const iY = bars.map(b => b[1]).concat(tgt.map(t => t[1]), ePts.map(p => p[1]));
  const iChart = chart({ bars: { pts: bars, color: 'var(--brand)', opacity: .85 }, series: [{ pts: tgt, color: 'var(--fat)', width: 2, dash: '5 4' }, { pts: ePts, color: 'var(--ink)', width: 1.6 }], xMin: i0, xMax: i1, yMin: 0, yMax: Math.max(...iY) * 1.08, xLabels: xl });
  const comp = span.filter(d => d.complete);
  const avgIn = comp.length ? comp.reduce((a, d) => a + d.intake, 0) / comp.length : null;
  const confidence = m.dataDays === 0 ? 'Starting estimate' : m.dataDays < 14 ? 'Calibrating' : 'Data-driven';
  const recentW = Object.keys(S.weights).sort().reverse().slice(0, 10);
  return `<div class="seg" style="margin-top:6px">${rangeBtns}</div>
  <section class="card"><div class="card-h"><h2>Weight trend</h2><a class="link" data-act="weight">Log weight</a></div>
    ${wChart}
    <div class="legend"><span><i class="dot" style="background:var(--mute)"></i>Scale weight</span><span><i class="dot" style="background:var(--brand)"></i>Trend weight</span></div>
    <div class="stats" style="margin-top:12px">
      <div class="stat" style="box-shadow:none;background:var(--surface-2)"><div class="k">Trend</div><div class="v num">${wFmt(last.trend)}<small> ${unit()}</small></div></div>
      <div class="stat" style="box-shadow:none;background:var(--surface-2)"><div class="k">In range</div><div class="v num">${ch >= 0 ? '+' : ''}${wDisp(ch).toFixed(1)}<small> ${unit()}</small></div></div>
      <div class="stat" style="box-shadow:none;background:var(--surface-2)"><div class="k">Last 7 days</div><div class="v num">${wkRate >= 0 ? '+' : ''}${wDisp(wkRate).toFixed(2)}<small> ${unit()}</small></div></div>
    </div></section>
  <section class="card"><div class="card-h"><h2>Expenditure</h2><span class="mute" style="font-size:13px">${confidence}</span></div>
    <div class="big num" style="font-size:52px">${fmt(last.E)}<span style="font-size:16px;font-weight:600;font-stretch:100%"> kcal/day</span></div>
    ${eChart}
    <p class="note">Started at ${fmt(S.init)} kcal from your profile. ${m.dataDays < 14 ? 'Keep logging food and weight — after about two weeks of data this estimate is driven by your real intake and weight change.' : `Now based on ${m.dataDays} days of your own intake and weight data.`}</p></section>
  <section class="card"><div class="card-h"><h2>Calories eaten</h2>${avgIn != null ? `<span class="mute num" style="font-size:13px">Avg ${fmt(avgIn)} kcal</span>` : ''}</div>
    ${iChart}
    <div class="legend"><span><i class="dot" style="background:var(--brand)"></i>Logged</span><span><i class="dot" style="background:var(--line)"></i>Incomplete</span><span><i class="dot" style="background:var(--fat)"></i>Target</span><span><i class="dot" style="background:var(--ink)"></i>Expenditure</span></div></section>
  <section class="card"><div class="card-h"><h2>Weigh-ins</h2></div>
    ${recentW.length ? recentW.map(k => `<button class="entry" data-act="weight" data-k="${k}"><span class="n"><b>${esc(niceDate(k, true))}</b></span><span class="k num">${wFmt(S.weights[k])} ${unit()}</span></button>`).join('') : '<div class="empty">No weigh-ins yet.</div>'}
  </section>`.replace('<section class="card"><div class="card-h"><h2>Expenditure', (K.strengthCard ? K.strengthCard(ui.range) : '') + '<section class="card"><div class="card-h"><h2>Expenditure');
}

function viewPlan() {
  const g = S.goal, cur = baseTargetsOn(todayKey()), L = latest(), T = S.train;
  const n = T.days.length, sh = T.shift;
  const tDelta = r0(cur.kcal * sh / 5) * 5, rDelta = n && n < 7 ? r0(tDelta * n / (7 - n)) : 0;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const hist = S.checkins.slice().reverse();
  const gw = g.target && g.type !== 'maintain' ? g.target : null;
  const eta = gw && g.type !== 'maintain' ? Math.abs((gw - L.trend) / goalRateKgWeek(L.trend)) : null;
  return `<section class="hero">
    <div class="card-h"><h2>Daily targets</h2><a class="link" data-act="goal">Edit</a></div>
    <div class="big num">${fmt(cur.kcal)}</div><div class="big-l">kcal per day</div>
    <div class="macros">${macroStatic('Protein', cur.p, 'var(--pro)')}${macroStatic('Carbs', cur.c, 'var(--carb)')}${macroStatic('Fat', cur.f, 'var(--fat)')}</div>
  </section>
  ${isBulk(g) && g.mode !== 'manual' ? bulkCard(cur, L) : ''}
  <section class="card"><div class="card-h"><h2>Training-day calories</h2></div>
    <p class="note" style="margin-top:0">Eat more on the days you train and a little less on rest days. Your weekly total stays the same, so your rate of progress doesn't change. The extra calories go to carbs to fuel your sessions.</p>
    <div class="seg" style="margin-top:12px">${[[0, 'Off'], [0.1, '+10%'], [0.15, '+15%'], [0.2, '+20%']].map(([v, l]) => `<button data-act="shift" data-v="${v}" aria-pressed="${sh === v}">${l}</button>`).join('')}</div>
    <div class="field"><span>Training days</span><div class="days">${order.map(i => `<button data-act="tday" data-v="${i}" aria-pressed="${T.days.includes(i)}" aria-label="${DAYS[i]}">${dayInitial(i)}</button>`).join('')}</div></div>
    ${sh && n && n < 7 ? `<div class="split"><div><span>Training day</span><b class="num">${fmt(cur.kcal + tDelta)}</b></div><div><span>Rest day</span><b class="num">${fmt(cur.kcal - rDelta)}</b></div><div><span>Weekly total</span><b class="num">${fmt(cur.kcal * 7)}</b></div></div>`
      : sh ? '<p class="note">Pick the days you usually train to turn this on.</p>' : ''}
  </section>
  <section class="card">
    <div class="kv"><span>Program</span><b>${g.mode === 'manual' ? 'Manual' : 'Coached'}</b></div>
    <div class="kv"><span>Goal</span><b>${goalLabel(g)}</b></div>
    ${g.mode !== 'manual' && g.type !== 'maintain' ? `<div class="kv"><span>Target pace</span><b>${goalRateKgWeek(L.trend) > 0 ? '+' : ''}${wDisp(goalRateKgWeek(L.trend)).toFixed(2)} ${unit()} / week</b></div>` : ''}
    ${gw ? `<div class="kv"><span>Goal weight</span><b>${wFmt(gw)} ${unit()}${eta && isFinite(eta) && (g.type === 'lose' ? L.trend > gw : L.trend < gw) ? ` · ~${Math.ceil(eta)} weeks` : ''}</b></div>` : ''}
    ${g.mode !== 'manual' ? `<div class="kv"><span>${isBulk(g) ? 'Macros' : 'Diet · protein'}</span><b>${isBulk(g) ? `${g.pLb} g/lb protein · ${r0(g.fatPct * 100)}% fat` : DIETS[g.diet][0] + ' · ' + PROTEIN[g.protein][0]}</b></div>
    <div class="kv"><span>Next check-in</span><b>${esc(niceDate(nextCheckin(), true))}</b></div>` : ''}
    ${g.mode !== 'manual' ? `<div class="row-btns"><button class="btn sm" data-act="checkin">Run check-in now</button></div>` : ''}
  </section>
  ${g.mode !== 'manual' ? `<section class="card"><div class="card-h"><h2>Check-in history</h2></div>
    ${hist.map(c => `<div class="kv"><span>${esc(niceDate(c.date, true))}${c.initial ? ' <span class="mute">(start)</span>' : ''}<br><span class="mute" style="font-size:13px">Expenditure ${fmt(c.E)} · trend ${wFmt(c.trend)} ${unit()}</span></span><b class="num">${fmt(c.kcal)} kcal<br><span class="mute" style="font-size:13px;font-weight:500">P${c.p} C${c.c} F${c.f}</span></b></div>`).join('')}
  </section>` : ''}
  <section class="card"><h2>How targets are set</h2>
    <p class="note">Each day Kalibra compares the calories you logged over the last 4 weeks with how your weight changed. 1 kg of body-weight change ≈ 7,700 kcal, so the difference reveals what you really burn. That number moves gradually to ignore water swings. At each weekly check-in your calories are set to expenditure ${g.type === 'lose' ? 'minus' : g.type === 'gain' ? 'plus' : '±'} your goal rate, and macros follow your diet style.</p>
    <p class="note">For the best accuracy: log everything (or mark the day incomplete), and weigh in most mornings under the same conditions.</p></section>`;
}

// Each number of the lean bulk with a one-line reason.
function bulkCard(cur, L) {
  const g = S.goal, m = model(), w = L.trend;
  const last = S.checkins[S.checkins.length - 1];
  const maint = last.maint || r0(bulkMaint(L.E, w, m.dataDays));
  const measured = m.dataDays >= BULK_DATA_DAYS;
  const row = (k, v, why) => `<div class="why"><div class="why-h"><span>${k}</span><b class="num">${v}</b></div><p>${why}</p></div>`;
  const lbs = w * LB;
  return `<section class="card"><div class="card-h"><h2>Your lean bulk</h2><a class="link" data-act="bulk-guide">Bulking guide</a></div>
    ${row('Target gain', `+${g.monthPct}% / month · ${wDisp(w * g.monthPct / 100).toFixed(2)} ${unit()}`, g.exp === 'beginner'
      ? 'In your first year you can build muscle quickly, so 1–2 % a month is mostly lean mass.'
      : 'How fast you gain decides how much fat you add. Muscle can’t be force-fed, so after year one 0.5–1 % a month is the sweet spot.')}
    ${row('Maintenance', `${fmt(maint)} kcal`, measured
      ? `Measured from ${m.dataDays} days of your logged intake and trend weight. It rises as you gain, so it’s re-measured every week.`
      : `Estimated as ${r0(lbs)} lb × ${LB_MULT[S.profile.activity]} for your activity level. After ${BULK_DATA_DAYS} days of logs it switches to your measured number (${m.dataDays}/${BULK_DATA_DAYS} so far).`)}
    ${row('Calories', `${fmt(cur.kcal)} kcal`, last.adj != null && !last.initial && last.why
      ? esc(last.why)
      : `Maintenance plus a ${r1(g.surplus * 100)} % surplus. Enough to fuel muscle growth without the extra fat of a dirty bulk. Weekly check-ins fine-tune it by up to ±${BULK_STEP} kcal.`)}
    ${row('Protein', `${cur.p} g`, `${g.pLb} g per lb of body weight. 0.7–1 g/lb (1.6–2.2 g/kg) supports muscle growth.`)}
    ${row('Fat', `${cur.f} g`, `${r0(g.fatPct * 100)} % of calories. Enough to support hormones; more than ~30 % is stored as fat more easily than carbs.`)}
    ${row('Carbs', `${cur.c} g`, 'Everything that’s left. Carbs fuel hard training — the stimulus that turns the surplus into muscle.')}
    ${!measured ? '<p class="note">Numbers marked as estimates firm up after two weeks of logging food and weight.</p>' : ''}
  </section>`;
}
function openBulkGuide() {
  const sec = (h, body) => `<section class="card guide"><h2>${h}</h2>${body}</section>`;
  const exp = S.goal && S.goal.exp;
  openSheet('Bulking guide', `
    <p class="mute" style="margin:0">How to gain muscle with as little fat as possible.</p>
    ${sec('Why bulk', '<p>A calorie surplus builds more muscle than eating at maintenance or recomping. You can still grow without one, but muscle is a lower priority for your body when energy is short. Dirty bulks (eating 50–100 % over maintenance) do build muscle, but add far more fat than muscle. The answer is a controlled surplus.</p>')}
    ${sec('1 · Rate of gain', `<p>How much fat you gain depends mostly on how fast you gain weight.</p>
      <div class="gt"><span>Beginner, under ~1 year</span><b>1–2 % / month</b><span>Intermediate or advanced</span><b>0.5–1 % / month</b></div>
      <p>A beginner may gain almost all muscle. Near your natural limit, expect about half muscle, half fat — that's fine. A slow cut afterwards removes the fat and keeps most of the muscle.</p>`)}
    ${sec('2 · Calories', '<p>Find maintenance — the intake where your weight is stable. Best: log food and weight daily for about two weeks. Quick estimate: body weight in lb × 14–18. Then eat 5–10 % above it.</p><p>Check your trend weight each week and adjust if you gain faster or slower than planned. Maintenance rises as you gain, so it keeps being re-measured.</p>')}
    ${sec('3 · Macros', '<p><b>Protein</b> 0.7–1 g per lb (1.6–2.2 g/kg). <b>Fat</b> 20–30 % of calories. <b>Carbs</b> fill the rest.</p><p>Once macros are tracked, food choice is flexible — treats fit if they fit your totals. Example day: egg whites, egg, vegetables, oats and berries · lean meat, rice, Greek yogurt and fruit before training · protein shake and a banana after · a flexible dinner · Greek yogurt, honey and peanut butter before bed.</p>')}
    ${sec('4 · Training', `<p>Slacking in the gym during a bulk is the surest way to gain mostly fat.</p>
      <div class="lvl ${exp === 'beginner' ? 'me' : ''}"><b>Beginner (year 1)</b><p>Learn technique on the basic lifts and push hard with good form. Any split works. At least 3 gym days a week; 4–5 is likely best.</p></div>
      <div class="lvl ${exp === 'intermediate' ? 'me' : ''}"><b>Intermediate (1–3 years)</b><p>More volume than as a beginner, but intensity first: about 8–15 hard sets per muscle per week. Big muscles like the back can take more. Consider moving off a bro split to avoid junk volume.</p></div>
      <div class="lvl ${exp === 'advanced' ? 'me' : ''}"><b>Advanced (3+ years)</b><p>Specialize: raise volume 20–40 % for one or two lagging muscles at a time (for example delts from 15 to 18–20 sets a week). Lengthened partials and other advanced techniques for the last gains.</p></div>`)}
    ${sec('5 · Cardio', '<p>Yes, in moderation. "Cardio kills gains" comes from outdated, low-quality evidence. Better conditioning helps you handle more training volume, especially on leg days. Desk job: 2–3 moderate sessions a week, like a brisk walk or casual sport. Very active job: extra cardio may not be needed.</p>')}
    ${sec('6 · Supplements', '<p><b>Core:</b> creatine 5 g a day · protein powder as needed to hit protein · about 200 mg caffeine before training if it doesn\'t hurt your sleep.</p><p><b>Optional:</b> fish oil (~2 g EPA + DHA a day), magnesium before bed, vitamin D if you get little sun, a multivitamin.</p>')}
    <p class="note">Based on Jeff Nippard, “How To Bulk Like A Pro (Using Science)”. The presenter co-owns MacroFactor; this advice doesn't depend on any app. General information, not medical advice — if you have a medical condition, a history of disordered eating, or are under 18, get individual advice.</p>`, { full: true });
}

function viewProfile() {
  const p = S.profile;
  const seg = (act, cur, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="${act}" data-v="${v}" aria-pressed="${cur === v}">${l}</button>`).join('')}</div>`;
  const h = unit() === 'lb' ? `${Math.floor(p.heightCm / 2.54 / 12)}′ ${r0(p.heightCm / 2.54 % 12)}″` : r0(p.heightCm) + ' cm';
  return `<section class="card"><div class="card-h"><h2>Profile</h2><a class="link" data-act="edit-profile">Edit</a></div>
    <div class="kv"><span>Sex</span><b>${p.sex === 'male' ? 'Male' : 'Female'}</b></div>
    <div class="kv"><span>Age</span><b>${age()}</b></div>
    <div class="kv"><span>Height</span><b>${h}</b></div>
    <div class="kv"><span>Activity</span><b>${ACTIVITY[p.activity][1]}</b></div>
    <div class="kv"><span>Body fat</span><b>${p.bodyFat ? p.bodyFat + '%' : 'Not set'}</b></div>
    <div class="kv"><span>Tracking since</span><b>${esc(niceDate(model().start, true))}</b></div></section>
  <section class="card"><h2>Preferences</h2>
    <label class="field"><span>Weight unit</span>${seg('set-unit', unit(), [['kg', 'Kilograms'], ['lb', 'Pounds']])}</label>
    <label class="field"><span>Language</span>${seg('set-lang', S.settings.lang, [['en', 'English'], ['sl', 'Slovenščina']])}</label>
    <label class="field"><span>Appearance</span>${seg('set-theme', S.settings.theme, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}</label>
    <label class="field"><span>Check-in day</span><select class="input" data-change="checkin-day">${DAYS.map((d, i) => `<option value="${i}" ${S.goal.checkinDay === i ? 'selected' : ''}>${d}</option>`).join('')}</select></label></section>
  <section class="card"><h2>Your data</h2>
    <p class="note">Everything is stored on this device only. Export a backup regularly, especially before clearing your browser.</p>
    <div class="row-btns"><button class="btn sm" data-act="export">Export backup</button><button class="btn sm ghost" data-act="import">Import backup</button></div>
    <div class="row-btns"><button class="btn sm danger" data-act="reset">Delete all data</button></div></section>
  <p class="note" style="text-align:center">Food data: USDA FoodData Central and Open Food Facts (ODbL).</p>`;
}

// ---------- food flow ----------
let foodTab = 'all', foodQ = '', searchTimer, onlineReq = 0;
function openFood() {
  foodQ = ''; foodTab = 'all';
  const el = openSheet('Log food', `
    <div class="search">${icon('search')}<input class="input" id="fq" type="search" placeholder="Search foods" autocomplete="off" autofocus></div>
    <div class="row-btns">
      <button class="btn sm ghost" data-act="scan">${icon('scan')}Scan</button>
      <button class="btn sm ghost" data-act="quick">${icon('bolt')}Quick add</button>
      <button class="btn sm ghost" data-act="create-food">${icon('edit')}Create food</button>
    </div>
    <div class="chips" id="ftabs"></div><div id="fres"></div>`, { full: true });
  const q = el.querySelector('#fq');
  q.addEventListener('input', () => { foodQ = q.value; clearTimeout(searchTimer); searchTimer = setTimeout(drawResults, foodTab === 'online' ? 450 : 80); });
  drawResults();
}
function drawResults() {
  const box = $('#fres'), tabs = $('#ftabs'); if (!box) return;
  tabs.innerHTML = [['all', 'All'], ['recent', 'Recent'], ['mine', 'My foods'], ['online', 'Online']]
    .map(([v, l]) => `<button class="chip" data-act="ftab" data-v="${v}" aria-pressed="${foodTab === v}">${v === 'online' ? icon('globe') : ''}${l}</button>`).join('');
  const q = foodQ.trim();
  let list;
  if (foodTab === 'online') {
    if (q.length < 2) { box.innerHTML = '<div class="empty"><b>Search branded products</b>Type a product name to search Open Food Facts.</div>'; return; }
    const req = ++onlineReq;
    box.innerHTML = '<div class="empty">Searching…</div>';
    offSearch(q).then(r => { if (req !== onlineReq) return; window._online = r; box.innerHTML = r.length ? r.map((f, i) => resultRow(f, 'online', i)).join('') : '<div class="empty"><b>No products found</b>Try a shorter name, or create the food yourself.</div>'; })
      .catch(() => { if (req === onlineReq) box.innerHTML = '<div class="empty"><b>Online search is unavailable</b>Check your connection. The built-in database still works offline.</div>'; });
    return;
  }
  if (foodTab === 'recent') list = S.recents.filter(f => !q || f.name.toLowerCase().includes(q.toLowerCase()));
  else if (foodTab === 'mine') list = searchLocal(q).filter(f => f.src === 'custom');
  else list = q ? searchLocal(q) : S.recents.slice(0, 8).concat(DB.filter(f => !S.recents.some(r => r.id === f.id)));
  list = list.slice(0, 80);
  window._list = list;
  box.innerHTML = (foodTab === 'all' && !q && S.recents.length ? '<p class="note">Recent and common foods</p>' : '') +
    (list.length ? list.map((f, i) => resultRow(f, 'list', i)).join('') : `<div class="empty"><b>No matches</b>${foodTab === 'mine' ? 'Foods you create appear here.' : 'Try the Online tab for branded products.'}</div>`) +
    (q.length > 1 && foodTab === 'all' ? `<button class="result" data-act="ftab" data-v="online"><span class="add-dot">${icon('globe')}</span><span class="n"><b>Search “${esc(q)}” online</b><span>Branded and packaged foods</span></span></button>` : '');
}
function resultRow(f, from, i) {
  const sv = f.servings && f.servings[0];
  const kcal = sv ? f.per100.kcal * sv.g / 100 : f.per100.kcal;
  return `<button class="result" data-act="pick" data-from="${from}" data-i="${i}">
    <span class="n"><b>${esc(f.name)}</b><span>${esc([f.brand && (f.src !== 'db' || f.typical) ? f.brand : '', sv ? sv.label : '100 g'].filter(Boolean).join(' · '))}</span></span>
    <span class="k num">${fmt(kcal)}<small>kcal</small></span><span class="add-dot">${icon('plus')}</span></button>`;
}

function openDetail(food, entry) {
  const units = [{ label: 'g', g: 1 }].concat(food.servings || []);
  let uI = entry ? Math.max(0, units.findIndex(u => u.label === entry.unit)) : (food.servings && food.servings.length ? 1 : 0);
  let qty = entry ? entry.qty : (uI ? 1 : 100);
  const tm = new Date(entry ? entry.t : Date.now());
  const el = openSheet(entry ? 'Edit entry' : 'Add food', `
    <h3 style="font-size:19px">${esc(food.name)}</h3>
    <p class="mute" style="margin:2px 0 0;font-size:14px">${esc(food.brand || '')}${food.brand ? ' · ' : ''}${fmt(food.per100.kcal)} kcal per 100 g</p>
    <div class="nutri" id="dn" style="margin-top:14px"></div>
    <div class="grid2"><label class="field"><span>Amount</span><input class="input num" id="dq" inputmode="decimal" value="${qty}"></label>
    <label class="field"><span>Unit</span><select class="input" id="du">${units.map((u, i) => `<option value="${i}" ${i === uI ? 'selected' : ''}>${esc(u.label)}${i ? ` (${u.g} g)` : ''}</option>`).join('')}</select></label></div>
    <label class="field"><span>Time</span><input class="input" id="dt" type="time" value="${String(tm.getHours()).padStart(2, '0')}:${String(tm.getMinutes()).padStart(2, '0')}"></label>
    <div class="row-btns" style="margin-top:20px"><button class="btn block" id="dsave">${entry ? 'Save changes' : 'Add to log'}</button></div>
    ${entry ? '<div class="row-btns"><button class="btn block danger" id="ddel">Delete entry</button></div>' : ''}`);
  const calc = () => {
    qty = num(el.querySelector('#dq').value); uI = +el.querySelector('#du').value;
    const g = (isFinite(qty) ? qty : 0) * units[uI].g;
    const n = nutrFor(food.per100, g);
    el.querySelector('#dn').innerHTML = `<div><b class="num">${fmt(n.kcal)}</b><span>kcal</span></div><div><b class="num" style="color:var(--pro)">${r1(n.p)}</b><span>protein</span></div><div><b class="num" style="color:var(--carb)">${r1(n.c)}</b><span>carbs</span></div><div><b class="num" style="color:var(--fat)">${r1(n.f)}</b><span>fat</span></div>`;
    return { g, n };
  };
  el.querySelector('#dq').addEventListener('input', calc);
  el.querySelector('#du').addEventListener('change', () => {
    const nu = +el.querySelector('#du').value; const qq = el.querySelector('#dq');
    qq.value = nu === 0 ? r0((num(qq.value) || 0) * units[uI].g) : (uI === 0 ? r1((num(qq.value) || 0) / units[nu].g) : 1);
    calc();
  });
  calc();
  el.querySelector('#dsave').onclick = () => {
    const { g, n } = calc();
    if (!(g > 0)) { toast('Enter an amount'); return; }
    const [hh, mm] = el.querySelector('#dt').value.split(':').map(Number);
    const when = pkey(ui.date); when.setHours(hh || 0, mm || 0);
    const u = units[uI];
    const rec = {
      id: entry ? entry.id : uid(), t: when.getTime(), name: food.name, food: stripFood(food), qty, unit: u.label, grams: g,
      amountLabel: uI ? `${r1(qty)} × ${u.label}` : `${r0(g)} g`,
      kcal: r1(n.kcal), p: r1(n.p), c: r1(n.c), f: r1(n.f), fib: r1(n.fib),
    };
    const arr = S.logs[ui.date] || (S.logs[ui.date] = []);
    if (entry) arr[arr.findIndex(e => e.id === entry.id)] = rec; else arr.push(rec);
    rememberRecent(stripFood(food)); save();
    closeAll(); render(); toast(entry ? 'Entry updated' : 'Added ' + fmt(n.kcal) + ' kcal');
  };
  const del = el.querySelector('#ddel');
  if (del) del.onclick = () => { S.logs[ui.date] = S.logs[ui.date].filter(e => e.id !== entry.id); save(); closeAll(); render(); toast('Entry deleted'); };
}
const stripFood = f => ({ src: f.src, id: f.id, name: f.name, brand: f.brand, per100: f.per100, servings: f.servings || [], code: f.code });

function openQuick(entry) {
  const e = entry || {};
  const el = openSheet(entry ? 'Edit quick add' : 'Quick add', `
    <label class="field"><span>Name (optional)</span><input class="input" id="qn" value="${esc(entry ? e.name : '')}" placeholder="e.g. Restaurant lunch"></label>
    <label class="field"><span>Calories</span><input class="input num" id="qk" inputmode="decimal" value="${entry ? e.kcal : ''}" placeholder="Leave blank to calculate from macros" autofocus></label>
    <div class="grid3"><label class="field"><span>Protein g</span><input class="input num" id="qp" inputmode="decimal" value="${entry ? e.p : ''}"></label>
    <label class="field"><span>Carbs g</span><input class="input num" id="qc" inputmode="decimal" value="${entry ? e.c : ''}"></label>
    <label class="field"><span>Fat g</span><input class="input num" id="qf" inputmode="decimal" value="${entry ? e.f : ''}"></label></div>
    <div class="row-btns" style="margin-top:20px"><button class="btn block" id="qs">${entry ? 'Save changes' : 'Add to log'}</button></div>
    ${entry ? '<div class="row-btns"><button class="btn block danger" id="qd">Delete entry</button></div>' : ''}`);
  el.querySelector('#qs').onclick = () => {
    const v = id => num(el.querySelector(id).value) || 0;
    const p = v('#qp'), c = v('#qc'), f = v('#qf');
    let k = num(el.querySelector('#qk').value);
    if (!isFinite(k)) k = p * 4 + c * 4 + f * 9;
    if (!(k > 0)) { toast('Enter calories or macros'); return; }
    const arr = S.logs[ui.date] || (S.logs[ui.date] = []);
    const when = pkey(ui.date); const now = new Date(); when.setHours(now.getHours(), now.getMinutes());
    const rec = { id: entry ? e.id : uid(), t: entry ? e.t : when.getTime(), name: el.querySelector('#qn').value.trim() || 'Quick add', quick: true, amountLabel: 'Quick add', kcal: r0(k), p, c, f, fib: 0 };
    if (entry) arr[arr.findIndex(x => x.id === e.id)] = rec; else arr.push(rec);
    save(); closeAll(); render(); toast(entry ? 'Entry updated' : 'Added ' + fmt(k) + ' kcal');
  };
  const d = el.querySelector('#qd');
  if (d) d.onclick = () => { S.logs[ui.date] = S.logs[ui.date].filter(x => x.id !== e.id); save(); closeAll(); render(); toast('Entry deleted'); };
}

function openCreateFood(code) {
  let per = 'serving';
  const el = openSheet('Create food', `
    <label class="field"><span>Name</span><input class="input" id="cn" placeholder="e.g. Protein bar, chocolate" autofocus></label>
    <label class="field"><span>Brand (optional)</span><input class="input" id="cb"></label>
    <div class="grid2"><label class="field"><span>Serving name</span><input class="input" id="cs" value="1 serving"></label>
    <label class="field"><span>Serving size (g or ml)</span><input class="input num" id="cg" inputmode="decimal" placeholder="e.g. 60"></label></div>
    <label class="field"><span>Nutrition values are per</span><div class="seg" id="cper"><button type="button" data-v="serving" aria-pressed="true">Serving</button><button type="button" data-v="100" aria-pressed="false">100 g</button></div></label>
    <div class="grid2"><label class="field"><span>Calories</span><input class="input num" id="ck" inputmode="decimal"></label>
    <label class="field"><span>Protein g</span><input class="input num" id="cp" inputmode="decimal"></label>
    <label class="field"><span>Carbs g</span><input class="input num" id="cc" inputmode="decimal"></label>
    <label class="field"><span>Fat g</span><input class="input num" id="cf" inputmode="decimal"></label>
    <label class="field"><span>Fiber g</span><input class="input num" id="cfi" inputmode="decimal"></label>
    <label class="field"><span>Barcode (optional)</span><input class="input num" id="cbc" inputmode="numeric" value="${esc(code || '')}"></label></div>
    <div class="row-btns" style="margin-top:20px"><button class="btn block" id="csave">Save and log</button></div>`);
  el.querySelector('#cper').onclick = e => { const b = e.target.closest('button'); if (!b) return; per = b.dataset.v; el.querySelectorAll('#cper button').forEach(x => x.setAttribute('aria-pressed', x === b)); };
  el.querySelector('#csave').onclick = () => {
    const v = id => num(el.querySelector(id).value);
    const name = el.querySelector('#cn').value.trim();
    const sg = v('#cg');
    if (!name) { toast('Give the food a name'); return; }
    if (per === 'serving' && !(sg > 0)) { toast('Enter the serving size in grams'); return; }
    let k = v('#ck'); const p = v('#cp') || 0, c = v('#cc') || 0, f = v('#cf') || 0, fib = v('#cfi') || 0;
    if (!isFinite(k)) k = p * 4 + c * 4 + f * 9;
    const m = per === 'serving' ? 100 / sg : 1;
    const food = {
      src: 'custom', id: 'c' + uid(), name, brand: el.querySelector('#cb').value.trim(), code: el.querySelector('#cbc').value.trim() || null,
      per100: { kcal: k * m, p: p * m, c: c * m, f: f * m, fib: fib * m },
      servings: sg > 0 ? [{ label: el.querySelector('#cs').value.trim() || '1 serving', g: sg }] : [],
    };
    S.custom.unshift(food); save();
    closeSheet(); openDetail(food);
  };
}

// ---------- barcode scanning ----------
let scanStop = null;
function openScan() {
  const el = openSheet('Scan barcode', `
    <video class="video" id="sv" playsinline muted></video>
    <p class="note" id="smsg">Point the camera at the barcode.</p>
    <label class="field"><span>Or type the barcode</span><input class="input num" id="sc" inputmode="numeric" placeholder="e.g. 3017620422003"></label>
    <div class="row-btns"><button class="btn block" id="sgo">Look up</button></div>`, { onClose: () => scanStop && scanStop() });
  el.querySelector('#sgo').onclick = () => { const c = el.querySelector('#sc').value.trim(); if (c) lookupCode(c); };
  startCamera(el.querySelector('#sv'), el.querySelector('#smsg'));
}
async function startCamera(video, msg) {
  let stream, raf, alive = true, zxCtl;
  scanStop = () => { alive = false; cancelAnimationFrame(raf); if (zxCtl) zxCtl.stop(); if (stream) stream.getTracks().forEach(t => t.stop()); scanStop = null; };
  const found = code => { if (!alive) return; scanStop(); if (navigator.vibrate) navigator.vibrate(40); lookupCode(code); };
  try {
    if ('BarcodeDetector' in window) {
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const loop = async () => {
        if (!alive) return;
        try { const r = await det.detect(video); if (r.length) return found(r[0].rawValue); } catch (e) {}
        raf = requestAnimationFrame(loop);
      };
      loop();
    } else {
      msg.textContent = 'Starting camera…';
      await loadScript('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js');
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      zxCtl = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res) found(res.getText()); });
      msg.textContent = 'Point the camera at the barcode.';
    }
  } catch (e) {
    msg.textContent = 'Camera unavailable — allow camera access or type the barcode below.';
  }
}
function loadScript(src) {
  return new Promise((ok, fail) => { if ([...document.scripts].some(s => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.append(s); });
}
async function lookupCode(code) {
  const mine = S.custom.find(f => f.code === code);
  if (mine) { closeSheet(); openDetail(mine); return; }
  toast('Looking up ' + code + '…');
  try {
    const f = await offBarcode(code);
    closeSheet();
    if (f) openDetail(f);
    else { toast('Product not found — add it yourself'); openCreateFood(code); }
  } catch (e) { toast('Lookup failed — check your connection'); }
}

// ---------- weight ----------
function openWeight(k) {
  k = k || ui.date;
  const cur = S.weights[k];
  const lastK = Object.keys(S.weights).sort().filter(x => x <= k).pop();
  const el = openSheet('Weigh-in', `
    <label class="field"><span>Date</span><input class="input" id="wd" type="date" value="${k}" max="${todayKey()}"></label>
    <label class="field"><span>Weight (${unit()})</span><input class="input num" id="wv" inputmode="decimal" value="${cur != null ? wFmt(cur) : ''}" placeholder="${lastK ? wFmt(S.weights[lastK]) : ''}" autofocus></label>
    <p class="note">Weigh first thing in the morning, after using the bathroom. Day-to-day jumps are normal — the trend line smooths them out.</p>
    <div class="row-btns" style="margin-top:16px"><button class="btn block" id="ws">Save weight</button></div>
    ${cur != null ? '<div class="row-btns"><button class="btn block danger" id="wdel">Delete weigh-in</button></div>' : ''}`);
  el.querySelector('#ws').onclick = () => {
    const v = num(el.querySelector('#wv').value), d = el.querySelector('#wd').value || k;
    const kg = wIn(v);
    if (!(kg > 25 && kg < 350)) { toast('Enter a valid weight'); return; }
    if (d !== k) delete S.weights[k];
    S.weights[d] = Math.round(kg * 100) / 100; save(); closeSheet(); render(); toast('Weight saved');
  };
  const del = el.querySelector('#wdel');
  if (del) del.onclick = () => {
    if (Object.keys(S.weights).length <= 1) { toast('Keep at least one weigh-in'); return; }
    delete S.weights[k]; save(); closeSheet(); render(); toast('Weigh-in deleted');
  };
}

// ---------- check-in ----------
function openCheckin() {
  const c = previewCheckin(), p = c.prev;
  const diff = c.kcal - p.kcal;
  const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmt(Math.abs(n));
  const exp = goalRateKgWeek(c.trend);
  const el = openSheet('Weekly check-in', `
    <div class="hero" style="margin-top:4px"><div class="big num">${fmt(c.kcal)}</div><div class="big-l">new daily target · ${sign(diff)} kcal vs. last week</div>
      <div class="macros">${macroStatic('Protein', c.p, 'var(--pro)')}${macroStatic('Carbs', c.c, 'var(--carb)')}${macroStatic('Fat', c.f, 'var(--fat)')}</div></div>
    <div class="card">
      <div class="kv"><span>Expenditure</span><b>${fmt(c.E)} kcal <span class="mute" style="font-weight:500">(${sign(c.E - p.E)})</span></b></div>
      <div class="kv"><span>Trend weight</span><b>${wFmt(c.trend)} ${unit()}</b></div>
      <div class="kv"><span>Change last 7 days</span><b>${c.trendChange == null ? '—' : (c.trendChange >= 0 ? '+' : '') + wDisp(c.trendChange).toFixed(2) + ' ' + unit()}</b></div>
      <div class="kv"><span>Goal pace</span><b>${exp >= 0 ? '+' : ''}${wDisp(exp).toFixed(2)} ${unit()} / week</b></div>
      <div class="kv"><span>Average intake</span><b>${c.avgIntake == null ? '—' : fmt(c.avgIntake) + ' kcal'} <span class="mute" style="font-weight:500">(${c.logged}/7 days logged)</span></b></div>
    </div>
    ${c.why ? `<div class="explain">${icon('bolt')}<p>${esc(c.why)}</p></div>` : ''}
    ${c.bulk && c.fresh ? `<div class="explain">${icon('bolt')}<p>Maintenance ${fmt(c.maint)} kcal ${c.dataDays >= BULK_DATA_DAYS ? 'measured from your logs' : 'estimated from body weight'} + ${r1(S.goal.surplus * 100)} % surplus.</p></div>` : ''}
    ${c.floored ? '<p class="note">Your target hit the minimum safe intake. A slower rate would be easier to sustain.</p>' : ''}
    ${c.logged < 5 ? '<p class="note">Fewer than 5 complete days were logged this week, so the expenditure estimate leaned on earlier data.</p>' : ''}
    <div class="row-btns" style="margin-top:16px"><button class="btn block" id="ca">Apply new targets</button></div>`);
  el.querySelector('#ca').onclick = () => { applyCheckin(); closeSheet(); render(); toast('Targets updated'); };
}

// ---------- goal editing ----------
function openGoal() {
  const g = JSON.parse(JSON.stringify(S.goal));
  const L = latest();
  if (!g.manual) { const t = targetsOn(todayKey()); g.manual = { kcal: t.kcal, p: t.p, c: t.c, f: t.f }; }
  const el = openSheet('Edit plan', '<div id="gb"></div>');
  const draw = () => {
    const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-k="${k}" data-v="${v}" aria-pressed="${String(g[k]) === String(v)}">${l}</button>`).join('')}</div>`;
    el.querySelector('#gb').innerHTML = `
      <label class="field"><span>Program</span>${seg('mode', [['coached', 'Coached'], ['manual', 'Manual']])}</label>
      ${g.mode === 'manual' ? `<p class="note">You set fixed targets. Expenditure is still tracked so you can compare.</p>
        <div class="grid2"><label class="field"><span>Protein g</span><input class="input num" data-m="p" inputmode="decimal" value="${g.manual.p}"></label>
        <label class="field"><span>Carbs g</span><input class="input num" data-m="c" inputmode="decimal" value="${g.manual.c}"></label>
        <label class="field"><span>Fat g</span><input class="input num" data-m="f" inputmode="decimal" value="${g.manual.f}"></label>
        <label class="field"><span>Calories</span><input class="input num" id="gk" value="${fmt(g.manual.p * 4 + g.manual.c * 4 + g.manual.f * 9)}" disabled></label></div>` : `
      <label class="field"><span>Goal</span>${seg('type', [['lose', 'Lose'], ['maintain', 'Maintain'], ['bulk', 'Lean bulk']].concat(g.type === 'gain' ? [['gain', 'Gain']] : []))}</label>
      ${g.type === 'bulk' ? `
        <label class="field"><span>Training experience</span>${seg('exp', Object.entries(BULK).map(([k, b]) => [k, b[0]]))}</label>
        <label class="field"><span>Target gain per month</span>${seg('monthPct', BULK[g.exp][2].map(r => [r, r + '%']))}</label>
        <p class="note">≈ ${wDisp(L.trend * g.monthPct / 100).toFixed(2)} ${unit()} per month</p>
        <label class="field"><span>Surplus over maintenance</span>${seg('surplus', [[0.05, '5%'], [0.075, '7.5%'], [0.1, '10%']])}</label>
        <label class="field"><span>Protein per lb of body weight</span>${seg('pLb', [[0.7, '0.7 g'], [0.85, '0.85 g'], [1, '1.0 g']])}</label>
        <label class="field"><span>Fat share of calories</span>${seg('fatPct', [[0.2, '20%'], [0.25, '25%'], [0.3, '30%']])}</label>
        <label class="field"><span>Goal weight (${unit()}, optional)</span><input class="input num" id="gt" inputmode="decimal" value="${g.target ? wFmt(g.target) : ''}"></label>
        <p class="note">Saving starts a fresh bulk: maintenance + surplus. Weekly check-ins then adjust from your trend weight.</p>` : g.type !== 'maintain' ? `<label class="field"><span>Rate (% of body weight per week)</span>${seg('ratePct', RATES[g.type].map(r => [r, r + '%']))}</label>
        <p class="note">≈ ${wDisp(L.trend * (g.ratePct || 0) / 100).toFixed(2)} ${unit()} per week</p>
        <label class="field"><span>Goal weight (${unit()}, optional)</span><input class="input num" id="gt" inputmode="decimal" value="${g.target ? wFmt(g.target) : ''}"></label>` : ''}
      ${g.type === 'bulk' ? '' : `<label class="field"><span>Diet style</span>${seg('diet', Object.entries(DIETS).map(([k, x]) => [k, x[0]]))}</label>
      <label class="field"><span>Protein</span>${seg('protein', Object.entries(PROTEIN).map(([k, x]) => [k, x[0]]))}</label>`}`}
      <div class="row-btns" style="margin-top:20px"><button class="btn block" id="gs">Save and update targets</button></div>`;
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k; let v = b.dataset.v; if (['ratePct', 'monthPct', 'surplus', 'pLb', 'fatPct'].includes(k)) v = +v;
    readGoalInputs(); g[k] = v;
    if (k === 'type' && RATES[v] && !RATES[v].includes(g.ratePct)) g.ratePct = RATES[v][1] || RATES[v][0];
    if (k === 'type' && v === 'bulk' && !g.exp) Object.assign(g, { exp: 'intermediate', monthPct: 0.75, surplus: 0.075, pLb: 0.85, fatPct: 0.25 });
    if (k === 'exp') { g.monthPct = BULK[v][3]; g.surplus = BULK[v][4]; }
    draw();
  });
  el.addEventListener('input', e => {
    const m = e.target.dataset.m; if (!m) return;
    g.manual[m] = num(e.target.value) || 0;
    el.querySelector('#gk').value = fmt(g.manual.p * 4 + g.manual.c * 4 + g.manual.f * 9);
  });
  function readGoalInputs() { const t = el.querySelector('#gt'); if (t) { const v = num(t.value); g.target = isFinite(v) ? wIn(v) : null; } }
  el.addEventListener('click', e => {
    if (e.target.id !== 'gs') return;
    readGoalInputs();
    if (g.type === 'maintain' || g.type === 'bulk') g.ratePct = 0;
    if (g.mode === 'manual') g.manual.kcal = r0(g.manual.p * 4 + g.manual.c * 4 + g.manual.f * 9);
    S.goal = g;
    if (g.mode !== 'manual') applyCheckin(true); else save();
    closeSheet(); render(); toast('Plan updated');
  });
  draw();
}

function openEditProfile() {
  const p = S.profile;
  const lb = unit() === 'lb';
  const el = openSheet('Edit profile', `
    <label class="field"><span>Sex</span><select class="input" id="ps"><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option><option value="male" ${p.sex === 'male' ? 'selected' : ''}>Male</option></select></label>
    <label class="field"><span>Year of birth</span><input class="input num" id="py" inputmode="numeric" value="${p.birthYear}"></label>
    <label class="field"><span>Height (${lb ? 'inches' : 'cm'})</span><input class="input num" id="ph" inputmode="decimal" value="${lb ? r1(p.heightCm / 2.54) : r0(p.heightCm)}"></label>
    <label class="field"><span>Body fat % (optional)</span><input class="input num" id="pb" inputmode="decimal" value="${p.bodyFat || ''}"></label>
    <label class="field"><span>Activity</span><select class="input" id="pa">${Object.entries(ACTIVITY).map(([k, a]) => `<option value="${k}" ${p.activity === k ? 'selected' : ''}>${a[1]}</option>`).join('')}</select></label>
    <p class="note">These only shape the starting estimate. After a few weeks your logged data drives expenditure.</p>
    <label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="pr"> <span style="margin:0">Reset expenditure estimate to the new profile</span></label>
    <div class="row-btns" style="margin-top:16px"><button class="btn block" id="psave">Save</button></div>`);
  el.querySelector('#psave').onclick = () => {
    const h = num(el.querySelector('#ph').value), y = +el.querySelector('#py').value, bf = num(el.querySelector('#pb').value);
    const hc = lb ? h * 2.54 : h;
    if (!(hc > 120 && hc < 240)) { toast('Enter a valid height'); return; }
    Object.assign(p, { sex: el.querySelector('#ps').value, birthYear: y || p.birthYear, heightCm: hc, bodyFat: bf > 3 ? bf : null, activity: el.querySelector('#pa').value });
    if (el.querySelector('#pr').checked) S.init = r0(initialTDEE(latest().trend));
    save(); closeSheet(); render(); toast('Profile saved');
  };
}

// ---------- actions ----------
const actions = {
  close: closeSheet,
  view: el => { toggleFab(false); go(el.dataset.v); },
  day: el => { const n = +el.dataset.n; transition(() => { ui.date = addDays(ui.date, n); render(); }, n); },
  fab: () => toggleFab(),
  'fab-close': () => toggleFab(false),
  dial: el => {
    toggleFab(false);
    const v = el.dataset.v;
    if (v === 'food') openFood();
    else if (v === 'weight') openWeight(todayKey());
    else if (K.startOrResume) K.startOrResume();
  },
  shift: el => { S.train.shift = +el.dataset.v; save(); render(); },
  tday: el => { const d = +el.dataset.v, T = S.train; T.days = T.days.includes(d) ? T.days.filter(x => x !== d) : T.days.concat(d); save(); render(); },
  food: () => openFood(),
  ftab: el => { foodTab = el.dataset.v; drawResults(); },
  pick: el => { const src = el.dataset.from === 'online' ? window._online : window._list; const f = src && src[+el.dataset.i]; if (f) openDetail(f); },
  quick: () => openQuick(),
  scan: () => openScan(),
  'create-food': () => openCreateFood(),
  'edit-entry': el => {
    const e = (S.logs[ui.date] || []).find(x => x.id === el.dataset.id); if (!e) return;
    if (e.quick || !e.food) openQuick(e); else openDetail(e.food, e);
  },
  'copy-day': () => {
    let k = addDays(ui.date, -1), n = 0;
    while (!(S.logs[k] && S.logs[k].length) && n < 14) { k = addDays(k, -1); n++; }
    const src = S.logs[k];
    if (!src || !src.length) { toast('No earlier day with food to copy'); return; }
    const base = pkey(ui.date).getTime() - pkey(k).getTime();
    const arr = S.logs[ui.date] || (S.logs[ui.date] = []);
    src.forEach(e => arr.push(Object.assign({}, e, { id: uid(), t: e.t + base })));
    save(); render(); toast('Copied ' + src.length + ' items from ' + niceDate(k));
  },
  'toggle-complete': () => { if (S.incomplete[ui.date]) delete S.incomplete[ui.date]; else S.incomplete[ui.date] = true; save(); render(); },
  weight: el => openWeight(el.dataset.k),
  range: el => { ui.range = +el.dataset.n; render(); },
  checkin: () => openCheckin(),
  'bulk-guide': () => openBulkGuide(),
  goal: () => openGoal(),
  'edit-profile': () => openEditProfile(),
  'set-unit': el => { S.settings.unit = el.dataset.v; save(); render(); },
  'toggle-lang': () => { S.settings.lang = isSl() ? 'en' : 'sl'; save(); applyTheme(); $('#app').innerHTML = ''; render(); toast(isSl() ? 'Jezik: slovenščina' : 'Language: English'); },
  'set-lang': el => { S.settings.lang = el.dataset.v; save(); applyTheme(); $('#app').innerHTML = ''; render(); },
  'set-theme': el => { S.settings.theme = el.dataset.v; save(); render(); },
  export: () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'kalibra-backup-' + todayKey() + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  import: () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json';
    i.onchange = async () => {
      try { const d = JSON.parse(await i.files[0].text()); if (!d.v || !d.profile) throw 0; S = Object.assign(blank(), d); save(); render(); toast('Backup restored'); }
      catch (e) { toast('That file is not a Kalibra backup'); }
    };
    i.click();
  },
  reset: () => { if (confirm(tt('Delete all food logs, weigh-ins and settings from this device? This cannot be undone.'))) { S = blank(); save(); ui.ob = { step: 0 }; render(); } },
  'ob-set': el => {
    const d = ui.ob.d, k = el.dataset.k; readObInputs(); let v = el.dataset.v;
    if (['ratePct', 'monthPct', 'pLb', 'fatPct'].includes(k)) v = +v;
    d[k] = v;
    if (k === 'type' && RATES[v] && !RATES[v].includes(d.ratePct)) d.ratePct = v === 'lose' ? 0.5 : 0.25;
    if (k === 'exp') d.monthPct = BULK[v][3];
    renderOnboarding();
  },
  'ob-lang': el => { S.settings.lang = el.dataset.v; save(); applyTheme(); renderOnboarding(); },
  'ob-back': () => { readObInputs(); ui.ob.step--; renderOnboarding(); },
  'ob-next': () => {
    readObInputs();
    const err = validateStep();
    if (err) { $('#ob-err').textContent = err; return; }
    if (ui.ob.step === OB_STEPS - 1) return finishOnboarding();
    ui.ob.step++; renderOnboarding(); scrollTo(0, 0);
  },
};
function readObInputs() { document.querySelectorAll('[data-ob]').forEach(i => { ui.ob.d[i.dataset.ob] = i.value.trim(); }); }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = actions[el.dataset.act]; if (fn) { e.preventDefault(); fn(el); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.change === 'checkin-day') { S.goal.checkinDay = +e.target.value; save(); render(); toast('Check-in day set to ' + DAYS[S.goal.checkinDay]); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.profile && !sheetStack.length) render(); });

// expose a few pure functions for testing
window.Kalibra = { model, computeTargets, macrosFor, get state() { return S; }, set state(v) { S = v; save(); } };

// Shared toolkit for feature modules (workouts.js). Modules add views, actions and hooks before first render.
Object.assign(K, {
  tt, loc, get S() { return S; }, save, render, go, transition, ui, VIEWS, TITLES, actions, openSheet, closeSheet, closeAll, toast, icon, esc, num, fmt, r0, r1, clamp, uid,
  todayKey, dkey, pkey, addDays, diffDays, niceDate, unit, wDisp, wIn, wFmt, chart, niceStep, latest, model, targetsOn, dayTotals, cnt, barW, animateIn,
  reduceMotion, PROTEIN, openFood,
});
window.K = K;
addEventListener('DOMContentLoaded', render);
})();
