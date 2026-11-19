/* Kalibra — workouts.
 * Templates and starter programs, live workout logging with a rest timer, load/rep suggestions
 * (double progression checked against estimated 1RM), PRs, weekly volume per muscle, and links to nutrition:
 * training days can carry more calories, and the protein left for the day is shown after a session.
 */
(() => {
'use strict';
const K = window.K;
const { esc, fmt, r0, r1, icon, num, uid, clamp } = K;
const MUS = window.KAL_MUSCLES;
const EX = Object.fromEntries(window.KAL_EXERCISES.map(r => [r[0], {
  id: r[0], name: r[1], primary: r[2], secondary: r[3] ? r[3].split(',') : [], equip: r[4], kind: r[5], met: r[6] || 0,
}]));
const T = () => K.S.train;
const DEFAULT_RIR = 2;
const STRENGTH_MET = 5.0; // Compendium: resistance training, multiple exercises, 8–15 reps, moderate–vigorous

const INFO = window.KAL_EX_INFO || {};
const info = id => { const r = INFO[id]; return r ? { stretch: r[0], overload: r[1], repMin: r[2], repMax: r[3], pick: r[4] || '', cues: r[5] || '' } : null; };
const ex = id => EX[id] || T().custom.find(c => c.id === id) || { id, name: 'Exercise', primary: 'abs', secondary: [], equip: '', kind: 'w' };
const allEx = () => T().custom.concat(Object.values(EX));
const isLift = e => e.kind === 'w' || e.kind === 'bw';

// ---------- units & maths ----------
const uLabel = () => K.unit();
const inc = e => K.unit() === 'lb' ? 5 : (e.equip === 'Dumbbell' ? 2 : 2.5);
const toDisp = kg => K.wDisp(kg);
const fromDisp = v => K.wIn(v);
function roundLoad(kg, e, dir = 'near') {
  const step = inc(e), d = toDisp(kg) / step;
  const r = dir === 'down' ? Math.floor(d + 1e-9) : dir === 'up' ? Math.ceil(d - 1e-9) : Math.round(d);
  return fromDisp(r * step);
}
const wTxt = kg => { const v = toDisp(kg); return (Math.round(v * 100) / 100).toString(); };
const e1Txt = kg => toDisp(kg).toFixed(1);
// Estimated 1-rep max (Epley), counting reps in reserve as reps you could still have done.
function e1rm(w, reps, rir = 0) { const n = reps + rir; return n <= 1 ? w : w * (1 + n / 30); }
const work = sets => sets.filter(s => s.done && !s.warm);
const setE1 = (s, e) => e1rm(s.w || 0, s.reps || 0, s.rir ?? DEFAULT_RIR);
const volume = sess => sess.exercises.reduce((a, x) => a + work(x.sets).reduce((b, s) => b + (s.w || 0) * (s.reps || 0), 0), 0);
const doneSets = sess => sess.exercises.reduce((a, x) => a + work(x.sets).length, 0);
const mins = ms => Math.max(1, Math.round(ms / 60000));
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function sessionKcal(sess) {
  const kg = K.latest().trend;
  let k = 0, strengthMin = 0;
  sess.exercises.forEach(x => {
    const e = ex(x.exId);
    if (e.kind === 'c') work(x.sets).forEach(s => { k += e.met * kg * (s.min || 0) / 60; });
  });
  const cardioMin = sess.exercises.filter(x => ex(x.exId).kind === 'c').reduce((a, x) => a + work(x.sets).reduce((b, s) => b + (s.min || 0), 0), 0);
  strengthMin = Math.max(0, mins((sess.end || Date.now()) - sess.start) - cardioMin);
  if (sess.exercises.some(x => ex(x.exId).kind !== 'c')) k += STRENGTH_MET * kg * strengthMin / 60;
  // MET values include resting metabolism; subtract it so this is the extra energy the session cost.
  return Math.max(0, r0(k - kg * (strengthMin + cardioMin) / 60));
}

// ---------- history & progression ----------
const sessionsDesc = () => T().sessions.slice().sort((a, b) => b.start - a.start);
function lastPerf(exId, before = Infinity) {
  for (const s of sessionsDesc()) {
    if (s.start >= before) continue;
    const x = s.exercises.find(y => y.exId === exId);
    if (x && work(x.sets).length) return { date: s.date, sets: work(x.sets), entry: x };
  }
  return null;
}
function bestE1(exId, before = Infinity) {
  let b = 0;
  T().sessions.forEach(s => { if (s.start < before) s.exercises.forEach(x => { if (x.exId === exId) work(x.sets).forEach(st => { b = Math.max(b, setE1(st)); }); }); });
  return b;
}
// Progress against the same set last time. One extra rep counts — that's how isolation lifts move for months.
function setGain(s, prev, e) {
  if (!prev || s.warm) return '';
  if (e.kind === 'c') return s.min > prev.min ? `+${r1(s.min - prev.min)} min` : '';
  if (e.kind === 't') return s.sec > prev.sec ? `+${s.sec - prev.sec} s` : '';
  const w = s.w || 0, pw = prev.w || 0, step = fromDisp(inc(e)) / 2;
  if (w > pw + 0.01) return `+${wTxt(w - pw)} ${uLabel()}`;
  if (Math.abs(w - pw) <= step && s.reps > prev.reps) return `+${s.reps - prev.reps} rep${s.reps - prev.reps > 1 ? 's' : ''}`;
  return '';
}
// Suggested load and reps for today: add reps inside the range; once every set reaches the top of the
// range, move up in load to the weight your estimated 1RM supports at the bottom of the range.
function suggest(x) {
  const e = ex(x.exId), last = lastPerf(x.exId, T().active ? T().active.start : Infinity);
  if (!last || !isLift(e)) return null;
  const lo = x.repMin, hi = x.repMax, rir = x.rir ?? DEFAULT_RIR;
  const sets = last.sets;
  const topW = Math.max(...sets.map(s => s.w || 0));
  const minReps = Math.min(...sets.map(s => s.reps || 0));
  const best = Math.max(...sets.map(s => e1rm(s.w || 0, s.reps || 0, s.rir ?? rir)));
  if (e.kind === 'bw' && !topW) return { w: 0, reps: Math.min(minReps + 1, hi + 5), why: minReps >= hi ? 'Beat last time — add a rep' : 'Add a rep per set' };
  if (minReps >= hi) {
    let w = roundLoad(best / (1 + (lo + rir) / 30), e, 'down');
    w = clamp(w, roundLoad(topW, e) + fromDisp(inc(e)), topW * 1.12);
    w = roundLoad(w, e, 'down');
    if (w <= topW) w = roundLoad(topW, e) + fromDisp(inc(e));
    return { w, reps: lo, why: `Top of range hit — up to ${wTxt(w)} ${uLabel()}` };
  }
  if (minReps < lo - 1) {
    const w = Math.min(topW, roundLoad(best / (1 + (lo + rir) / 30), e, 'down'));
    return { w, reps: lo, why: 'Below range last time — load adjusted' };
  }
  return { w: topW, reps: clamp(minReps + 1, lo, hi), why: 'Same load, one more rep' };
}

// ---------- templates ----------
function templateFromDay(name, items, program) {
  return { id: 't' + uid(), name, program: program || null, exercises: items.map(([exId, sets, repMin, repMax]) => ({ exId, sets, repMin, repMax, rest: restFor(ex(exId)) })) };
}
const restFor = e => e.kind === 'c' ? 0 : ['Barbell'].includes(e.equip) && ['quads', 'glutes', 'hamstrings', 'chest', 'upperback'].includes(e.primary) ? 180 : e.secondary.length >= 2 ? 150 : 90;
function nextTemplate() {
  const tpls = T().templates; if (!tpls.length) return null;
  const last = sessionsDesc().find(s => s.templateId && tpls.some(t => t.id === s.templateId));
  if (!last) return tpls[0];
  const lt = tpls.find(t => t.id === last.templateId);
  const group = tpls.filter(t => t.program === lt.program);
  const i = group.indexOf(lt);
  return group[(i + 1) % group.length] || tpls[0];
}

// ---------- live workout ----------
function startWorkout(tpl) {
  if (T().active) { openWorkout(); return; }
  const now = Date.now();
  T().active = {
    id: 's' + uid(), date: K.todayKey(), start: now, name: tpl ? tpl.name : 'Workout', templateId: tpl ? tpl.id : null, restEnd: null,
    exercises: tpl ? tpl.exercises.map(te => newEntry(te.exId, te)) : [],
  };
  K.save(); K.render(); openWorkout();
}
function newEntry(exId, te) {
  const e = ex(exId);
  const inf = info(exId);
  const x = { uid: uid(), exId, repMin: te ? te.repMin : inf ? inf.repMin : 8, repMax: te ? te.repMax : inf ? inf.repMax : 12, rir: DEFAULT_RIR, rest: te ? te.rest : restFor(e), sets: [] };
  const n = te ? te.sets : (e.kind === 'c' ? 1 : 3);
  for (let i = 0; i < n; i++) x.sets.push({ done: false });
  return x;
}
let wEl = null, tick = null;
function openWorkout() {
  const a = T().active; if (!a) return;
  wEl = K.openSheet(a.name, '<div id="wo"></div>', { full: true, onClose: () => { wEl = null; clearInterval(tick); K.render(); } });
  wEl.classList.add('workout');
  drawWorkout();
  clearInterval(tick);
  tick = setInterval(() => { const c = wEl && wEl.querySelector('#wclock'); if (c && T().active) c.textContent = clock(Date.now() - T().active.start); }, 1000);
  wEl.addEventListener('click', onWorkoutClick);
  wEl.addEventListener('input', onWorkoutInput);
  wEl.addEventListener('change', onWorkoutInput);
}
function drawWorkout() {
  const a = T().active, box = wEl && wEl.querySelector('#wo'); if (!a || !box) return;
  const sb = wEl.querySelector('.sheet-b'), top = sb.scrollTop;
  box.innerHTML = `<div class="wo-bar"><div><span class="mute">Elapsed</span><b class="num" id="wclock">${clock(Date.now() - a.start)}</b></div>
      <div><span class="mute">Sets</span><b class="num">${doneSets(a)}</b></div>
      <div><span class="mute">Volume</span><b class="num">${fmt(toDisp(volume(a)))}</b></div>
      <button class="btn sm" data-wa="finish">Finish</button></div>
    ${a.exercises.map(exerciseCard).join('') || `<div class="empty"><b>Empty workout</b>Add your first exercise to get going.</div>`}
    <div class="row-btns"><button class="btn block ghost" data-wa="add-ex">${icon('plus')}Add exercise</button></div>
    <div class="row-btns"><button class="btn block danger" data-wa="discard">Discard workout</button></div>`;
  sb.scrollTop = top;
}
function exerciseCard(x, xi) {
  const e = ex(x.exId), sg = suggest(x), last = lastPerf(x.exId, T().active.start);
  const lift = isLift(e);
  const hint = e.kind === 'c' ? 'Minutes of steady effort' : sg ? sg.why : last ? '' : `First time — choose a load you could lift ${x.repMin}–${x.repMax} times with about ${DEFAULT_RIR} reps left`;
  let warm = 0, work_ = 0;
  const rows = x.sets.map((s, si) => {
    const label = s.warm ? 'W' : ++work_;
    if (s.warm) warm++;
    const prev = last && !s.warm ? last.sets[work_ - 1] : null;
    const prevTxt = prev ? (e.kind === 'c' ? prev.min + ' min' : e.kind === 't' ? prev.sec + ' s' : (prev.w ? wTxt(prev.w) + '×' : '') + prev.reps) : '—';
    const phW = s.warm ? '' : sg ? wTxt(sg.w) : prev ? wTxt(prev.w || 0) : '';
    const phR = s.warm ? '' : sg ? sg.reps : prev ? prev.reps : x.repMin;
    let inputs;
    if (e.kind === 'c') inputs = `<input class="si" inputmode="decimal" data-f="min" data-x="${xi}" data-s="${si}" value="${s.min ?? ''}" placeholder="${prev ? prev.min : 20}" aria-label="Minutes"><span class="si-u">min</span>`;
    else if (e.kind === 't') inputs = `<input class="si" inputmode="numeric" data-f="sec" data-x="${xi}" data-s="${si}" value="${s.sec ?? ''}" placeholder="${prev ? prev.sec : 45}" aria-label="Seconds"><span class="si-u">sec</span>`;
    else inputs = `<input class="si" inputmode="decimal" data-f="w" data-x="${xi}" data-s="${si}" value="${s.w != null ? wTxt(s.w) : ''}" placeholder="${phW}" aria-label="Weight ${uLabel()}">
      <input class="si" inputmode="numeric" data-f="reps" data-x="${xi}" data-s="${si}" value="${s.reps ?? ''}" placeholder="${phR}" aria-label="Reps">
      <select class="si rir" data-f="rir" data-x="${xi}" data-s="${si}" aria-label="Reps in reserve">${['', 0, 1, 2, 3, 4, 5].map(v => `<option value="${v}" ${String(s.rir ?? '') === String(v) ? 'selected' : ''}>${v === '' ? 'RIR' : v === 5 ? '5+' : v}</option>`).join('')}</select>`;
    const g = s.done ? setGain(s, prev, e) : '';
    return `<div class="srow ${s.done ? 'done' : ''} ${s.warm ? 'warm' : ''} ${e.kind === 'c' || e.kind === 't' ? 'one' : ''}" data-row="${xi}-${si}" data-gain="${esc(g)}">
      <button class="sn" data-wa="set-type" data-x="${xi}" data-s="${si}" aria-label="Set type">${label}</button>
      <span class="sp num">${prevTxt}</span>${inputs}
      <button class="sc" data-wa="check" data-x="${xi}" data-s="${si}" aria-label="Complete set" aria-pressed="${!!s.done}">${icon('check')}</button></div>`;
  }).join('');
  return `<section class="xcard" data-xi="${xi}">
    <div class="xh"><button class="xn" data-wa="ex-info" data-id="${x.exId}"><b>${esc(e.name)}</b><span>${esc(MUS[e.primary] || '')}${lift ? ` · ${x.repMin}–${x.repMax} reps` : ''}${x.rest ? ` · rest ${x.rest >= 60 ? Math.floor(x.rest / 60) + ':' + String(x.rest % 60).padStart(2, '0') : x.rest + 's'}` : ''}</span></button>
      <button class="icon-btn sm" data-wa="ex-menu" data-x="${xi}" aria-label="Exercise options">${icon('dots')}</button></div>
    ${(() => { const inf = info(x.exId); return inf && (inf.pick || inf.cues) ? `<details class="cues"><summary>${inf.pick ? `<span class="pick">${esc(inf.pick)}</span>` : ''}Setup cues</summary><p>${esc(inf.cues || 'Control the lowering, 2–8 seconds per rep, and keep your form the same every week.')}</p></details>` : ''; })()}
    ${x.formChange ? `<p class="xhint warn">${icon('bolt')}Technique marked as changed today — extra reps may be fake overload.</p>` : ''}
    ${hint ? `<p class="xhint">${sg ? icon('bolt') : ''}${esc(hint)}${sg && sg.w ? ` <b>${wTxt(sg.w)} ${uLabel()} × ${sg.reps}</b>` : ''}</p>` : ''}
    <div class="shead ${e.kind === 'c' || e.kind === 't' ? 'one' : ''}"><span>Set</span><span>Previous</span>${e.kind === 'c' ? '<span>Time</span>' : e.kind === 't' ? '<span>Hold</span>' : `<span>${uLabel()}</span><span>Reps</span><span>RIR</span>`}<span></span></div>
    ${rows}
    <button class="addset" data-wa="add-set" data-x="${xi}">${icon('plus')}Add set</button></section>`;
}
function onWorkoutInput(e) {
  const f = e.target.dataset.f; if (!f) return;
  const a = T().active, s = a.exercises[+e.target.dataset.x].sets[+e.target.dataset.s];
  const v = num(e.target.value);
  if (f === 'w') s.w = isFinite(v) ? fromDisp(v) : null;
  else if (f === 'rir') s.rir = e.target.value === '' ? null : +e.target.value;
  else s[f] = isFinite(v) ? v : null;
  K.save();
}
function onWorkoutClick(e) {
  const b = e.target.closest('[data-wa]'); if (!b) return;
  const a = T().active; if (!a) return;
  const xi = +b.dataset.x, si = +b.dataset.s, x = a.exercises[xi];
  const act = b.dataset.wa;
  if (act === 'check') {
    const s = x.sets[si], ent = ex(x.exId), row = b.closest('.srow');
    if (!s.done) {
      // fill empty fields from the suggestion / placeholders
      row.querySelectorAll('input.si').forEach(inp => { if (inp.value === '' && inp.placeholder !== '') { inp.value = inp.placeholder; inp.dispatchEvent(new Event('input', { bubbles: true })); } });
      const ok = ent.kind === 'c' ? s.min > 0 : ent.kind === 't' ? s.sec > 0 : s.reps > 0;
      if (!ok) { K.toast(ent.kind === 'c' ? 'Enter minutes' : 'Enter reps'); return; }
      if (ent.kind === 'w' && !(s.w >= 0)) s.w = 0;
      s.done = true;
      const pr = !s.warm && isLift(ent) && s.w > 0 && setE1(s) > bestE1(x.exId, a.start) && bestE1(x.exId, a.start) > 0;
      s.pr = pr || undefined;
      row.classList.add('done', 'pop'); b.setAttribute('aria-pressed', 'true');
      if (navigator.vibrate) navigator.vibrate(18);
      const last = lastPerf(x.exId, a.start), wi = x.sets.slice(0, si).filter(z => !z.warm).length;
      const g = setGain(s, last && last.sets[wi], ent);
      s.gain = g || undefined; row.dataset.gain = g;
      if (pr) { K.toast('New personal record on ' + ent.name); row.classList.add('pr'); }
      else if (g) K.toast(g + ' vs last time — that’s progress');
      if (x.rest && !s.warm) startRest(x.rest);
    } else { s.done = false; s.pr = undefined; s.gain = undefined; row.dataset.gain = ''; row.classList.remove('done', 'pr'); b.setAttribute('aria-pressed', 'false'); }
    K.save();
    const bar = wEl.querySelector('.wo-bar');
    if (bar) { bar.children[1].querySelector('b').textContent = doneSets(a); bar.children[2].querySelector('b').textContent = fmt(toDisp(volume(a))); }
    return;
  }
  if (act === 'add-set') { const prev = x.sets.filter(s => !s.warm).pop(); x.sets.push({ done: false, w: prev && prev.w != null ? prev.w : undefined }); K.save(); drawWorkout(); return; }
  if (act === 'set-type') { const s = x.sets[si]; if (s.done) return; s.warm = !s.warm; K.save(); drawWorkout(); return; }
  if (act === 'ex-menu') return exerciseMenu(xi);
  if (act === 'ex-info') return openExercise(b.dataset.id);
  if (act === 'add-ex') return pickExercise(id => { a.exercises.push(newEntry(id)); K.save(); drawWorkout(); setTimeout(() => { const sb = wEl.querySelector('.sheet-b'); sb.scrollTo({ top: sb.scrollHeight, behavior: 'smooth' }); }, 60); });
  if (act === 'finish') return finishWorkout();
  if (act === 'discard') {
    if (!confirm('Discard this workout? Logged sets will be lost.')) return;
    T().active = null; stopRest(); K.save(); K.closeAll(); K.render(); K.toast('Workout discarded');
  }
}
function exerciseMenu(xi) {
  const a = T().active, x = a.exercises[xi], e = ex(x.exId);
  const el = K.openSheet(e.name, `
    ${isLift(e) ? `<div class="grid2"><label class="field"><span>Min reps</span><input class="input num" id="mlo" inputmode="numeric" value="${x.repMin}"></label>
    <label class="field"><span>Max reps</span><input class="input num" id="mhi" inputmode="numeric" value="${x.repMax}"></label></div>
    <label class="field"><span>Target reps in reserve</span><select class="input" id="mrir">${[0, 1, 2, 3].map(v => `<option ${x.rir === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
    <label class="field" style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" id="mform" ${x.formChange ? 'checked' : ''} style="margin-top:4px"><span style="margin:0">My technique changed today (looser form, more momentum, shorter range). Extra reps with changed form are fake overload — they don't mean more muscle.</span></label>
    <label class="field"><span>Rest between sets</span><select class="input" id="mrest">${[0, 60, 90, 120, 150, 180, 240, 300].map(v => `<option value="${v}" ${x.rest === v ? 'selected' : ''}>${v ? Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0') : 'No timer'}</option>`).join('')}</select></label>
    <div class="row-btns" style="margin-top:16px"><button class="btn block" id="msave">Save</button></div>
    <div class="row-btns">${xi > 0 ? '<button class="btn sm ghost" id="mup">Move up</button>' : ''}${xi < a.exercises.length - 1 ? '<button class="btn sm ghost" id="mdown">Move down</button>' : ''}<button class="btn sm ghost" id="mswap">Swap exercise</button><button class="btn sm danger" id="mdel">Remove</button></div>`);
  const done = () => { K.save(); K.closeSheet(); drawWorkout(); };
  el.querySelector('#msave').onclick = () => {
    const lo = +(el.querySelector('#mlo') || {}).value, hi = +(el.querySelector('#mhi') || {}).value;
    if (lo > 0 && hi >= lo) { x.repMin = lo; x.repMax = hi; }
    const r = el.querySelector('#mrir'); if (r) x.rir = +r.value;
    x.rest = +el.querySelector('#mrest').value; x.formChange = el.querySelector('#mform').checked || undefined; done();
  };
  const mv = d => { const arr = a.exercises; [arr[xi], arr[xi + d]] = [arr[xi + d], arr[xi]]; done(); };
  const up = el.querySelector('#mup'); if (up) up.onclick = () => mv(-1);
  const dn = el.querySelector('#mdown'); if (dn) dn.onclick = () => mv(1);
  el.querySelector('#mdel').onclick = () => { a.exercises.splice(xi, 1); done(); };
  el.querySelector('#mswap').onclick = () => { K.closeSheet(); swapExercise(x.exId, id => { const n = newEntry(id); n.repMin = x.repMin; n.repMax = x.repMax; n.sets = x.sets.map(() => ({ done: false })); a.exercises[xi] = n; K.save(); drawWorkout(); }); };
}

// ---------- rest timer ----------
let restT = null;
function startRest(sec) { T().active.restEnd = Date.now() + sec * 1000; T().active.restLen = sec; K.save(); showRest(); }
function stopRest() { document.body.classList.remove('resting'); clearInterval(restT); restT = null; const r = document.getElementById('rest'); if (r) { r.classList.remove('on'); setTimeout(() => r.remove(), 300); } if (T().active) T().active.restEnd = null; }
function showRest() {
  let r = document.getElementById('rest');
  document.body.classList.add('resting');
  if (!r) {
    r = document.createElement('div'); r.id = 'rest'; r.className = 'rest';
    r.innerHTML = `<svg viewBox="0 0 44 44" class="ring"><circle cx="22" cy="22" r="19" class="ring-bg"/><circle cx="22" cy="22" r="19" class="ring-fg" pathLength="100"/></svg>
      <div class="rest-t"><span class="mute">Rest</span><b class="num" id="restv"></b></div>
      <button data-r="-15">−15</button><button data-r="15">+15</button><button data-r="skip">Skip</button>`;
    r.addEventListener('click', e => {
      const b = e.target.closest('[data-r]'); if (!b || !T().active) return;
      if (b.dataset.r === 'skip') return stopRest();
      T().active.restEnd += +b.dataset.r * 1000; T().active.restLen = Math.max(1, T().active.restLen + +b.dataset.r); K.save(); upd();
    });
    document.body.append(r);
    requestAnimationFrame(() => r.classList.add('on'));
  }
  const upd = () => {
    const a = T().active; if (!a || !a.restEnd) return stopRest();
    const left = a.restEnd - Date.now();
    if (left <= 0) { stopRest(); restDone(); return; }
    r.querySelector('#restv').textContent = clock(left + 999);
    r.querySelector('.ring-fg').style.strokeDashoffset = String(100 - clamp(left / (a.restLen * 1000) * 100, 0, 100));
  };
  clearInterval(restT); restT = setInterval(upd, 200); upd();
}
function restDone() {
  if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.15); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.16); });
  } catch (e) {}
  K.toast('Rest over — next set');
}

// ---------- finish ----------
function finishWorkout() {
  const a = T().active;
  const kept = a.exercises.map(x => Object.assign({}, x, { sets: x.sets.filter(s => s.done) })).filter(x => x.sets.length);
  if (!kept.length) { if (confirm('No sets are checked off. Discard this workout?')) { T().active = null; stopRest(); K.save(); K.closeAll(); K.render(); } return; }
  const sess = Object.assign({}, a, { end: Date.now(), exercises: kept });
  delete sess.restEnd; delete sess.restLen;
  sess.kcal = sessionKcal(sess);
  const prs = kept.reduce((n, x) => n + x.sets.filter(s => s.pr).length, 0);
  const gains = kept.reduce((n, x) => n + x.sets.filter(s => s.gain).length, 0);
  const fake = kept.filter(x => x.formChange && x.sets.some(s => s.gain && /rep/.test(s.gain))).map(x => ex(x.exId).name);
  const tpl = T().templates.find(t => t.id === a.templateId);
  const changed = tpl && (tpl.exercises.length !== a.exercises.length || tpl.exercises.some((te, i) => !a.exercises[i] || te.exId !== a.exercises[i].exId || te.sets !== a.exercises[i].sets.filter(s => !s.warm).length));
  T().sessions.push(sess); T().active = null; stopRest(); K.save();
  K.closeAll(); K.render();
  // nutrition tie-in
  const k = sess.date, tg = K.targetsOn(k), tot = K.dayTotals(k);
  const pLeft = r0(tg.p - tot.p);
  const el = K.openSheet('Workout complete', `
    <div class="done-hero"><div class="burst">${icon('trophy')}</div><h3>${esc(sess.name)}</h3><p class="mute">${K.niceDate(k, true)} · ${mins(sess.end - sess.start)} min</p></div>
    <div class="nutri">
      <div><b class="num">${K.cnt('fin-sets', doneSets(sess))}</b><span>${doneSets(sess) === 1 ? 'set' : 'sets'}</span></div>
      <div><b class="num">${K.cnt('fin-vol', r0(toDisp(volume(sess))))}</b><span>${uLabel()} lifted</span></div>
      <div><b class="num">${K.cnt('fin-pr', gains)}</b><span>sets beat</span></div>
      <div><b class="num">${K.cnt('fin-kcal', sess.kcal)}</b><span>kcal est.</span></div></div>
    ${gains || prs ? `<div class="explain good">${icon('trophy')}<p>${gains ? `You beat last time on <b>${gains} set${gains > 1 ? 's' : ''}</b>. Even one extra rep is progressive overload.` : ''}${prs ? ` ${prs} new personal record${prs > 1 ? 's' : ''}.` : ''}</p></div>` : ''}
    ${fake.length ? `<div class="explain warn">${icon('bolt')}<p>Possible fake overload on ${fake.map(esc).join(', ')}: reps went up on a day you marked your technique as changed. Keep form identical week to week so extra reps mean extra muscle.</p></div>` : ''}
    <div class="card fuel">
      <h2>${icon('apple')} Refuel</h2>
      <p class="note">${pLeft > 0 ? `You have <b>${pLeft} g of protein</b> left today. A meal with 30–50 g in the next few hours supports recovery.` : 'You have already hit your protein target today — nice.'}
      ${tg.delta > 0 ? ` Today counts as a training day, so your target includes <b>+${fmt(tg.delta)} kcal</b> extra carbs.` : ''}</p>
      <p class="note">The ${sess.kcal} kcal estimate is for reference only. Your expenditure is measured from your intake and weight, so training is already counted and not added twice.</p>
      <div class="row-btns"><button class="btn sm" id="flog">${icon('plus')}Log a meal</button></div></div>
    ${!tpl ? '<div class="row-btns"><button class="btn block ghost" id="fsave">Save as template</button></div>' : changed ? '<div class="row-btns"><button class="btn block ghost" id="fupd">Update template with these changes</button></div>' : ''}
    <div class="row-btns"><button class="btn block" data-act="close">Done</button></div>`);
  K.animateIn(el);
  el.querySelector('#flog').onclick = () => { K.closeSheet(); K.ui.date = k; K.openFood(); };
  const toTpl = () => sess.exercises.map(x => ({ exId: x.exId, sets: x.sets.filter(s => !s.warm).length || 1, repMin: x.repMin, repMax: x.repMax, rest: x.rest }));
  const fs = el.querySelector('#fsave');
  if (fs) fs.onclick = () => { const name = prompt('Template name', sess.name === 'Workout' ? 'My workout' : sess.name); if (!name) return; const t = { id: 't' + uid(), name, program: null, exercises: toTpl() }; T().templates.push(t); sess.templateId = t.id; K.save(); fs.remove(); K.toast('Template saved'); };
  const fu = el.querySelector('#fupd');
  if (fu) fu.onclick = () => { tpl.exercises = toTpl(); K.save(); fu.remove(); K.toast('Template updated'); };
}

// ---------- swap: rank substitutes by the three criteria ----------
// 1) tension in the stretched position, 2) feels good (only you can judge — hide ones that hurt), 3) can be overloaded.
function swapExercise(curId, cb) {
  const cur = ex(curId);
  const avoid = T().avoid || (T().avoid = []);
  const dots = n => '●'.repeat(n) + '○'.repeat(3 - n);
  const score = e => { const i = info(e.id); return i ? i.stretch * 2 + i.overload + (i.pick ? 1.5 : 0) : 2; };
  const el = K.openSheet('Swap ' + cur.name, '<div id="sw"></div>', { full: true });
  const draw = () => {
    const list = allEx().filter(e => e.id !== curId && e.primary === cur.primary && !avoid.includes(e.id)).sort((a, b) => score(b) - score(a));
    el.querySelector('#sw').innerHTML = `<p class="note" style="margin-top:0">Ranked by how well each one ticks the three boxes: tension when the muscle is stretched, feels good in your joints, and room to keep adding reps or weight.</p>
      ${list.map((e, i) => { const n = info(e.id) || { stretch: 2, overload: 2 }; return `<button class="swap" data-id="${e.id}">
        <span class="n"><b>${esc(e.name)}${i === 0 ? ' <span class="pick">Best match</span>' : n.pick ? ` <span class="pick">${esc(n.pick.split(' · ')[0])}</span>` : ''}</b>
        <span class="crit"><em>Stretch <i>${dots(n.stretch)}</i></em><em>Overload <i>${dots(n.overload)}</i></em><em>${esc(e.equip)}</em></span></span><span class="add-dot">${icon('plus')}</span></button>`; }).join('') || '<div class="empty">No other exercises for this muscle.</div>'}
      <div class="row-btns"><button class="btn block ghost" id="swhurt">${icon('minus')}${esc(cur.name)} doesn’t feel good — hide it</button></div>
      <div class="row-btns"><button class="btn block ghost" id="swall">Browse all exercises</button></div>
      ${avoid.length ? `<p class="note">Hidden because they didn’t feel good: ${avoid.map(id => esc(ex(id).name)).join(', ')}. <a class="link" id="swreset">Show again</a></p>` : ''}
      <p class="note">Sharp pain, or pain in a joint, means stop and swap.</p>`;
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('.swap[data-id]'); if (b) { K.closeSheet(); cb(b.dataset.id); return; }
    if (e.target.closest('#swhurt')) { if (!avoid.includes(curId)) avoid.push(curId); K.save(); K.toast('Hidden from swap suggestions'); draw(); }
    if (e.target.closest('#swall')) { K.closeSheet(); pickExercise(cb); }
    if (e.target.closest('#swreset')) { T().avoid = []; K.save(); K.closeSheet(); swapExercise(curId, cb); }
  });
  draw();
}

// ---------- pickers & editors ----------
function pickExercise(cb) {
  let q = '', mus = '';
  const el = K.openSheet('Add exercise', `<div class="search">${icon('search')}<input class="input" id="xq" type="search" placeholder="Search exercises" autocomplete="off"></div>
    <div class="chips" id="xm"></div><div id="xl"></div>
    <div class="row-btns"><button class="btn block ghost" id="xnew">${icon('edit')}Create exercise</button></div>`, { full: true });
  const draw = () => {
    el.querySelector('#xm').innerHTML = [['', 'All']].concat(Object.entries(MUS)).map(([k, l]) => `<button class="chip" data-m="${k}" aria-pressed="${mus === k}">${l}</button>`).join('');
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = allEx().filter(e => (!mus || e.primary === mus || e.secondary.includes(mus)) && toks.every(t => (e.name + ' ' + e.equip + ' ' + (MUS[e.primary] || '')).toLowerCase().includes(t)))
      .sort((a, b) => (mus && a.primary === mus ? 0 : 1) - (mus && b.primary === mus ? 0 : 1));
    el.querySelector('#xl').innerHTML = list.map(e => `<button class="result" data-id="${e.id}"><span class="n"><b>${esc(e.name)}</b><span>${esc(MUS[e.primary] || '')} · ${esc(e.equip)}</span></span><span class="add-dot">${icon('plus')}</span></button>`).join('') || '<div class="empty"><b>No matches</b>Create the exercise yourself below.</div>';
  };
  el.querySelector('#xq').addEventListener('input', e => { q = e.target.value; draw(); });
  el.addEventListener('click', e => {
    const m = e.target.closest('[data-m]'); if (m) { mus = m.dataset.m; draw(); return; }
    const r = e.target.closest('.result[data-id]'); if (r) { K.closeSheet(); cb(r.dataset.id); }
  });
  el.querySelector('#xnew').onclick = () => createExercise(id => { K.closeSheet(); cb(id); });
  draw();
}
function createExercise(cb) {
  const el = K.openSheet('Create exercise', `
    <label class="field"><span>Name</span><input class="input" id="cxn" placeholder="e.g. Smith machine squat" autofocus></label>
    <label class="field"><span>Main muscle</span><select class="input" id="cxm">${Object.entries(MUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
    <label class="field"><span>Equipment</span><select class="input" id="cxe">${['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Cardio'].map(v => `<option>${v}</option>`).join('')}</select></label>
    <div class="row-btns" style="margin-top:16px"><button class="btn block" id="cxs">Save exercise</button></div>`);
  el.querySelector('#cxs').onclick = () => {
    const name = el.querySelector('#cxn').value.trim(); if (!name) { K.toast('Give the exercise a name'); return; }
    const equip = el.querySelector('#cxe').value, prim = el.querySelector('#cxm').value;
    const e = { id: 'x' + uid(), name, primary: prim, secondary: [], equip, kind: equip === 'Cardio' ? 'c' : equip === 'Bodyweight' ? 'bw' : 'w', met: equip === 'Cardio' ? 6 : 0 };
    T().custom.push(e); K.save(); K.closeSheet(); cb(e.id);
  };
}
function editTemplate(tpl) {
  const isNew = !tpl;
  const d = tpl ? JSON.parse(JSON.stringify(tpl)) : { id: 't' + uid(), name: '', program: null, exercises: [] };
  const el = K.openSheet(isNew ? 'New template' : 'Edit template', '<div id="te"></div>', { full: true });
  const draw = () => {
    el.querySelector('#te').innerHTML = `<label class="field"><span>Name</span><input class="input" id="tn" value="${esc(d.name)}" placeholder="e.g. Push day"></label>
      <div style="margin-top:14px">${d.exercises.map((x, i) => { const e = ex(x.exId); return `<div class="trow"><div class="n"><b>${esc(e.name)}</b><span class="mute">${esc(MUS[e.primary] || '')}</span></div>
        ${isLift(e) ? `<label><input class="si" data-i="${i}" data-f="sets" inputmode="numeric" value="${x.sets}"><span>sets</span></label><label><input class="si" data-i="${i}" data-f="repMin" inputmode="numeric" value="${x.repMin}"><span>min</span></label><label><input class="si" data-i="${i}" data-f="repMax" inputmode="numeric" value="${x.repMax}"><span>max</span></label>` : `<label><input class="si" data-i="${i}" data-f="sets" inputmode="numeric" value="${x.sets}"><span>sets</span></label>`}
        <button class="icon-btn sm" data-del="${i}" aria-label="Remove">${icon('trash')}</button></div>`; }).join('') || '<div class="empty">No exercises yet.</div>'}</div>
      <div class="row-btns"><button class="btn block ghost" id="tadd">${icon('plus')}Add exercise</button></div>
      <div class="row-btns"><button class="btn block" id="tsave">Save template</button></div>
      ${isNew ? '' : '<div class="row-btns"><button class="btn block danger" id="tdel">Delete template</button></div>'}`;
  };
  el.addEventListener('input', e => {
    if (e.target.id === 'tn') d.name = e.target.value;
    const f = e.target.dataset.f; if (f) d.exercises[+e.target.dataset.i][f] = Math.max(1, +e.target.value || 1);
  });
  el.addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (del) { d.exercises.splice(+del.dataset.del, 1); draw(); return; }
    if (e.target.closest('#tadd')) pickExercise(id => { const x = ex(id); const inf = info(id); d.exercises.push({ exId: id, sets: x.kind === 'c' ? 1 : 3, repMin: inf ? inf.repMin : 8, repMax: inf ? inf.repMax : 12, rest: restFor(x) }); draw(); });
    if (e.target.closest('#tsave')) {
      if (!d.name.trim()) { K.toast('Name the template'); return; }
      const arr = T().templates, i = arr.findIndex(t => t.id === d.id);
      if (i >= 0) arr[i] = d; else arr.push(d);
      K.save(); K.closeSheet(); K.render(); K.toast('Template saved');
    }
    if (e.target.closest('#tdel') && confirm('Delete this template? Past workouts are kept.')) { T().templates = T().templates.filter(t => t.id !== d.id); K.save(); K.closeSheet(); K.render(); }
  });
  draw();
}
function addProgram() {
  const P = window.KAL_PROGRAMS;
  const el = K.openSheet('Add a program', P.map((p, i) => `<button class="choice" data-p="${i}"><b>${esc(p[0])}</b><span>${esc(p[1])} · ${p[2].map(d => esc(d[0])).join(', ')}</span></button>`).join('') +
    '<p class="note">Programs add one template per training day. Edit them anytime — change exercises, sets or rep ranges.</p>');
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const p = P[+b.dataset.p], prog = 'p' + uid();
    p[2].forEach(([name, items]) => T().templates.push(templateFromDay(name, items, prog)));
    K.save(); K.closeSheet(); K.render(); K.toast(p[0] + ' added');
  });
}
function openSession(id) {
  const s = T().sessions.find(x => x.id === id); if (!s) return;
  const el = K.openSheet(s.name, `<p class="mute" style="margin:0">${esc(K.niceDate(s.date, true))} · ${mins(s.end - s.start)} min · ${fmt(toDisp(volume(s)))} ${uLabel()} · ≈${s.kcal || 0} kcal</p>
    ${s.exercises.map(x => { const e = ex(x.exId); return `<div class="card" style="padding:14px"><b>${esc(e.name)}</b>${x.sets.map((st, i) => `<div class="kv"><span>${st.warm ? 'Warm-up' : 'Set ' + (i + 1)}${st.pr ? ' <span class="pr-tag">PR</span>' : ''}</span><b>${e.kind === 'c' ? st.min + ' min' : e.kind === 't' ? st.sec + ' s' : (st.w ? wTxt(st.w) + ' ' + uLabel() + ' × ' : '') + st.reps + (st.rir != null ? ' @' + st.rir + ' RIR' : '')}</b></div>`).join('')}</div>`; }).join('')}
    <div class="row-btns"><button class="btn block danger" id="sdel">Delete workout</button></div>`);
  el.querySelector('#sdel').onclick = () => { if (!confirm('Delete this workout from your history?')) return; T().sessions = T().sessions.filter(x => x.id !== id); K.save(); K.closeSheet(); K.render(); };
}
function openExercise(id) {
  const e = ex(id);
  const hist = T().sessions.filter(s => s.exercises.some(x => x.exId === id)).sort((a, b) => a.start - b.start);
  const pts = hist.map(s => { const best = Math.max(...s.exercises.filter(x => x.exId === id).flatMap(x => work(x.sets).map(st => setE1(st)))); return [s.start, best, s]; }).filter(p => isFinite(p[1]) && p[1] > 0);
  let chartH = '';
  if (pts.length >= 2 && isLift(e)) {
    const ys = pts.map(p => toDisp(p[1]));
    const pad = Math.max(1, (Math.max(...ys) - Math.min(...ys)) * 0.15);
    chartH = K.chart({ h: 160, series: [{ pts: pts.map((p, i) => [i, toDisp(p[1])]), color: 'var(--brand)', width: 3 }, { pts: pts.map((p, i) => [i, toDisp(p[1])]), dots: true, color: 'var(--brand)', r: 3.5 }], xMin: 0, xMax: pts.length - 1, yMin: Math.min(...ys) - pad, yMax: Math.max(...ys) + pad, xLabels: [[0, K.niceDate(pts[0][2].date)], [pts.length - 1, K.niceDate(pts[pts.length - 1][2].date)]] });
  }
  const best = pts.length ? Math.max(...pts.map(p => p[1])) : 0;
  const inf = info(id);
  K.openSheet(e.name, `<p class="mute" style="margin:0">${esc(MUS[e.primary] || '')}${e.secondary.length ? ' · also ' + e.secondary.map(m => MUS[m]).join(', ') : ''} · ${esc(e.equip)}</p>
    ${inf ? `<div class="card">${inf.pick ? `<span class="pick">${esc(inf.pick)}</span>` : ''}
      ${inf.cues ? `<p style="margin:${inf.pick ? '10px' : '0'} 0 0">${esc(inf.cues)}</p>` : ''}
      <div class="kv"><span>Tension in the stretch</span><b>${['', 'Low', 'Medium', 'High'][inf.stretch]}</b></div>
      <div class="kv"><span>Easy to overload</span><b>${['', 'Hard', 'Medium', 'Easy'][inf.overload]}</b></div>
      <div class="kv"><span>Default rep range</span><b>${inf.repMin}–${inf.repMax}</b></div></div>` : ''}
    ${isLift(e) && best ? `<div class="card"><div class="card-h"><h2>Estimated 1-rep max</h2><b class="num">${e1Txt(best)} ${uLabel()}</b></div>${chartH || '<p class="note">Log this exercise in two sessions to see your trend.</p>'}</div>` : ''}
    <div class="card"><div class="card-h"><h2>History</h2></div>${hist.slice().reverse().slice(0, 12).map(s => `<div class="kv"><span>${esc(K.niceDate(s.date, true))}</span><b>${s.exercises.filter(x => x.exId === id).flatMap(x => work(x.sets)).map(st => e.kind === 'c' ? st.min + ' min' : e.kind === 't' ? st.sec + 's' : (st.w ? wTxt(st.w) + '×' : '') + st.reps).join(', ')}</b></div>`).join('') || '<div class="empty">Not logged yet.</div>'}</div>`);
}

function openTips() {
  const sec = (h, b) => `<section class="card guide"><h2>${h}</h2>${b}</section>`;
  const picks = Object.entries(INFO).filter(([, r]) => r[4]).map(([id, r]) => `<button class="kv lift" data-id="${id}"><span>${esc(r[4].replace('Top pick · ', ''))}</span><b>${esc(ex(id).name)}</b></button>`).join('');
  const el = K.openSheet('Training tips', `
    <p class="mute" style="margin:0">How to pick exercises and make every set count.</p>
    ${sec('How to judge an exercise', '<p>An exercise earns a top spot when it has all three:</p><ol><li><b>High tension in the stretch</b> — the muscle has something to work against when it’s longest.</li><li><b>It feels good</b> — smooth, no pain, felt in the muscle more than the joints.</li><li><b>Room to overload</b> — you can keep adding reps or weight.</li></ol><p>Use these to choose a substitute when a machine is taken or something hurts. The Swap button in a workout does this for you.</p>')}
    ${sec('Top picks per muscle', picks + '<p class="note">Train back with two types: a vertical pull and a horizontal row. Train triceps both ways: overhead (stretch) and with the arm behind you (contraction). Tap a pick for setup cues.</p>')}
    ${sec('Rep tempo', '<p>Anywhere from 2 to 8 seconds per full rep works equally well. Avoid bouncy, very fast reps and very slow 10–20 second reps. Control the lowering.</p>')}
    ${sec('Sets to failure', '<p>For higher-rep work, take at least one set to true failure. Most people stop 4–5 reps early when they “feel done”. Log reps in reserve (RIR) honestly — Kalibra uses it to suggest your next weight.</p>')}
    ${sec('Weekly volume', '<p>About 3 hard sets a week for a muscle already gives roughly 60 % of the growth possible. More sets add more, with diminishing returns. The Sets per muscle chart on the Train tab tracks this.</p>')}
    ${sec('Lengthened partials', '<p>Partial reps in the stretched half of the range — for a squat, only come about halfway up. Harder than full reps, because there’s no rest at the top.</p>')}
    ${sec('Progressive overload — and the fake kind', '<p>Track every set. Adding one rep to one set is progress, even when the weight on lateral raises stalls for months. Kalibra marks these with a green “+1 rep”.</p><p><b>Watch for fake overload:</b> technique slowly getting looser, like your chest coming off the pad on a supported row by week six. Keep form the same every week. If your form changed, mark it in the exercise menu and Kalibra will flag rep jumps on that day.</p>')}
    ${sec('Calves and abs', '<p>The source video skips them. The library includes standing and seated calf raises, cable crunches, hanging leg raises and ab-wheel rollouts — the same three criteria apply.</p>')}
    <p class="note">Picks and numbers from Will Tennyson ft. Jeff Nippard, “The Best Exercises For Every Muscle”. The video is sponsored by MacroFactor, which doesn't affect the exercise advice. Stretch and overload ratings for other exercises are Kalibra's own. General information, not medical advice — sharp or joint pain means stop and swap.</p>`, { full: true });
  el.addEventListener('click', e => { const b = e.target.closest('.lift[data-id]'); if (b) openExercise(b.dataset.id); });
}

// ---------- views ----------
function weekStart(k) { const d = K.pkey(k).getDay(); return K.addDays(k, -((d + 6) % 7)); } // Monday
function muscleVolume(fromK) {
  const v = {};
  T().sessions.filter(s => s.date >= fromK).forEach(s => s.exercises.forEach(x => {
    const e = ex(x.exId); if (e.kind === 'c') return;
    const n = work(x.sets).length;
    v[e.primary] = (v[e.primary] || 0) + n;
    e.secondary.forEach(m => { v[m] = (v[m] || 0) + n * 0.5; });
  }));
  return v;
}
function viewTrain() {
  const a = T().active, nx = nextTemplate(), t = K.todayKey();
  const wk = weekStart(t), mv = muscleVolume(wk);
  const weekSessions = T().sessions.filter(s => s.date >= wk);
  const groups = {};
  T().templates.forEach(tp => { (groups[tp.program || 'mine'] = groups[tp.program || 'mine'] || []).push(tp); });
  const tplCard = tp => `<div class="tpl"><button class="tpl-b" data-act="tpl-start" data-id="${tp.id}"><b>${esc(tp.name)}</b><span>${tp.exercises.map(x => esc(ex(x.exId).name)).join(' · ')}</span></button>
    <button class="icon-btn sm" data-act="tpl-edit" data-id="${tp.id}" aria-label="Edit ${esc(tp.name)}">${icon('edit')}</button></div>`;
  const muscles = Object.keys(MUS).filter(m => m !== 'cardio');
  const g = K.S.goal, band = g && g.type === 'bulk' && g.exp !== 'beginner' ? [8, 15] : [10, 20];
  const recent = sessionsDesc().slice(0, 8);
  return `${a ? `<button class="hero resume" data-act="wo-resume"><div class="pulse"></div><div><span class="big-l">Workout in progress</span><b class="resume-n">${esc(a.name)}</b><span class="big-l">${doneSets(a)} sets done · started ${new Date(a.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></div>${icon('play')}</button>`
    : nx ? `<section class="hero next"><span class="big-l">Up next</span><div class="resume-n">${esc(nx.name)}</div>
        <p class="next-l">${nx.exercises.slice(0, 4).map(x => esc(ex(x.exId).name)).join(' · ')}${nx.exercises.length > 4 ? ` +${nx.exercises.length - 4}` : ''}</p>
        <button class="btn light" data-act="tpl-start" data-id="${nx.id}">${icon('play')}Start workout</button></section>`
    : `<section class="hero next"><span class="big-l">Get started</span><div class="resume-n">Pick a program</div><p class="next-l">Start from a proven split or build your own. Kalibra suggests the weight and reps for every set.</p>
        <button class="btn light" data-act="program">Browse programs</button></section>`}
  <div class="stats">
    <div class="stat"><div class="k">This week</div><div class="v num">${K.cnt('wk-s', weekSessions.length)}<small> workouts</small></div></div>
    <div class="stat"><div class="k">Sets</div><div class="v num">${K.cnt('wk-sets', weekSessions.reduce((n, s) => n + doneSets(s), 0))}</div></div>
    <div class="stat"><div class="k">Volume</div><div class="v num">${K.cnt('wk-v', r1(toDisp(weekSessions.reduce((n, s) => n + volume(s), 0)) / 1000), 1)}<small> t</small></div></div>
  </div>
  ${!a ? `<div class="row-btns"><button class="btn sm ghost" data-act="wo-empty">${icon('plus')}Empty workout</button><button class="btn sm ghost" data-act="tpl-new">${icon('edit')}New template</button><button class="btn sm ghost" data-act="program">${icon('dumbbell')}Programs</button></div>` : ''}
  ${T().templates.length ? `<section class="card"><div class="card-h"><h2>Templates</h2></div>${Object.values(groups).map(g => g.map(tplCard).join('')).join('<hr class="sep">')}</section>` : ''}
  <button class="tcard" data-act="train-tips"><span class="ic">${icon('bolt')}</span><span class="n"><b>Training tips</b><span>Best exercises per muscle, tempo, failure, real vs fake overload</span></span>${icon('right')}</button>
  <section class="card"><div class="card-h"><h2>Sets per muscle this week</h2><span class="mute" style="font-size:13px">Target ${band[0]}–${band[1]}</span></div>
    <div class="mv">${muscles.map(m => { const v = mv[m] || 0; return `<div class="mv-r"><span>${MUS[m]}</span><div class="mv-b"><i class="mv-zone" style="left:${band[0] / 24 * 100}%;width:${(band[1] - band[0]) / 24 * 100}%"></i>${K.barW('mv-' + m, v / 24 * 100, v >= band[0] ? 'var(--brand)' : v > 0 ? 'var(--fat)' : 'transparent')}</div><b class="num">${r1(v)}</b></div>`; }).join('')}</div>
    <p class="note">Direct sets count fully; muscles that assist count as half a set. ${band[0] === 8 ? 'During your lean bulk aim for about 8–15 hard sets per muscle a week, intensity first; big muscles like the back can take more.' : '10–20 hard sets per muscle per week suits most people; even 3 gets you a good part of the way.'}</p></section>
  <section class="card"><div class="card-h"><h2>History</h2><a class="link" data-act="ex-lib">Exercises</a></div>
    ${recent.length ? recent.map(s => `<button class="entry" data-act="sess" data-id="${s.id}"><span class="n"><b>${esc(s.name)}</b><span>${esc(K.niceDate(s.date, true))} · ${mins(s.end - s.start)} min · ${doneSets(s)} sets${s.exercises.some(x => x.sets.some(st => st.pr)) ? ' · <span class="pr-tag">PR</span>' : ''}</span></span><span class="k num">${fmt(toDisp(volume(s)))}<small class="mute"> ${uLabel()}</small></span></button>`).join('')
      : '<div class="empty"><b>No workouts yet</b>Your finished sessions and personal records show up here.</div>'}
  </section>`;
}
function exerciseLibrary() {
  const el = K.openSheet('Exercises', '<div class="search">' + icon('search') + '<input class="input" id="lq" type="search" placeholder="Search exercises"></div><div id="ll"></div>', { full: true });
  const draw = q => {
    const t = q.toLowerCase();
    el.querySelector('#ll').innerHTML = allEx().filter(e => e.name.toLowerCase().includes(t)).map(e => {
      const b = bestE1(e.id);
      return `<button class="result" data-id="${e.id}"><span class="n"><b>${esc(e.name)}</b><span>${esc(MUS[e.primary] || '')} · ${esc(e.equip)}</span></span>${b ? `<span class="k num">${e1Txt(b)}<small>e1RM ${uLabel()}</small></span>` : ''}</button>`;
    }).join('');
  };
  el.querySelector('#lq').addEventListener('input', e => draw(e.target.value));
  el.addEventListener('click', e => { const r = e.target.closest('.result[data-id]'); if (r) openExercise(r.dataset.id); });
  draw('');
}

// Today screen card
function trainingCard(k) {
  const a = T().active, today = k === K.todayKey();
  const done = T().sessions.filter(s => s.date === k);
  if (a && today) return `<button class="tcard live" data-act="wo-resume"><span class="pulse"></span><span class="n"><b>Workout in progress</b><span>${esc(a.name)} · ${doneSets(a)} sets done</span></span>${icon('play')}</button>`;
  if (done.length) return done.map(s => `<button class="tcard" data-act="sess" data-id="${s.id}"><span class="ic">${icon('dumbbell')}</span><span class="n"><b>${esc(s.name)}</b><span>${mins(s.end - s.start)} min · ${doneSets(s)} sets · ≈${s.kcal || 0} kcal</span></span><span class="tick">${icon('check')}</span></button>`).join('');
  if (!today) return '';
  const nx = nextTemplate(), planned = T().days.includes(K.pkey(k).getDay());
  if (!nx && !planned) return '';
  return `<button class="tcard" data-act="${nx ? 'tpl-start' : 'wo-empty'}" ${nx ? `data-id="${nx.id}"` : ''}><span class="ic">${icon('dumbbell')}</span><span class="n"><b>${planned ? 'Training day' : 'Ready to train?'}</b><span>${nx ? 'Up next: ' + esc(nx.name) : 'Start a workout'}</span></span>${icon('play')}</button>`;
}
// Progress screen card
function strengthCard(range) {
  const S_ = T().sessions; if (!S_.length) return '';
  const t = K.todayKey(), from = K.addDays(t, -Math.min(range, 3650));
  const ws = weekStart(from), weeks = [];
  for (let k = ws; k <= t; k = K.addDays(k, 7)) weeks.push(k);
  const vol = weeks.map((w, i) => [i, toDisp(S_.filter(s => s.date >= w && s.date < K.addDays(w, 7)).reduce((a, s) => a + volume(s), 0)) / 1000]);
  const maxV = Math.max(1, ...vol.map(v => v[1]));
  const ch = K.chart({ h: 150, bars: { pts: vol.map(([i, v]) => [i, v, 'var(--brand)']), color: 'var(--brand)' }, series: [], xMin: -0.5, xMax: weeks.length - 0.5, yMin: 0, yMax: maxV * 1.1, xLabels: [[0, K.niceDate(weeks[0])], [weeks.length - 1, K.niceDate(weeks[weeks.length - 1])]] });
  // top lifts by number of sessions
  const freq = {};
  S_.forEach(s => s.exercises.forEach(x => { if (isLift(ex(x.exId)) && ex(x.exId).kind === 'w') freq[x.exId] = (freq[x.exId] || 0) + 1; }));
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => {
    const inRange = S_.filter(s => s.date >= from && s.exercises.some(x => x.exId === id)).sort((a, b) => a.start - b.start);
    const bestIn = s => Math.max(...s.exercises.filter(x => x.exId === id).flatMap(x => work(x.sets).map(st => setE1(st))));
    if (!inRange.length) return '';
    const first = bestIn(inRange[0]), last = bestIn(inRange[inRange.length - 1]), d = last - first;
    return `<button class="kv lift" data-act="ex-open" data-id="${id}"><span>${esc(ex(id).name)}</span><b class="num">${e1Txt(last)} ${uLabel()} <span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : '−'}${e1Txt(Math.abs(d))}</span></b></button>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h2>Strength</h2><span class="mute" style="font-size:13px">Weekly volume, tonnes</span></div>${ch}
    ${top ? `<p class="note" style="margin-bottom:0">Estimated 1-rep max in this range</p>${top}` : ''}
    <p class="note">Losing weight while these numbers hold or climb means you're keeping muscle.</p></section>`;
}

// ---------- register with the app ----------
K.VIEWS.train = viewTrain;
K.trainingCard = trainingCard;
K.strengthCard = strengthCard;
K.startOrResume = () => { if (T().active) openWorkout(); else { const nx = nextTemplate(); nx ? startWorkout(nx) : startWorkout(null); } };
Object.assign(K.actions, {
  'wo-resume': () => openWorkout(),
  'wo-empty': () => startWorkout(null),
  'tpl-start': el => { const tp = T().templates.find(t => t.id === el.dataset.id); if (T().active) { openWorkout(); return; } if (tp) startWorkout(tp); },
  'tpl-edit': el => editTemplate(T().templates.find(t => t.id === el.dataset.id)),
  'tpl-new': () => editTemplate(null),
  program: () => addProgram(),
  sess: el => openSession(el.dataset.id),
  'ex-lib': () => exerciseLibrary(),
  'ex-open': el => openExercise(el.dataset.id),
  'train-tips': () => openTips(),
});
// resume a running rest timer after reload
addEventListener('DOMContentLoaded', () => { const a = K.S.train && K.S.train.active; if (a && a.restEnd && a.restEnd > Date.now()) showRest(); });
window.KalibraTrain = { suggest, e1rm, sessionKcal, nextTemplate };
})();
