/* Kalibra — body measurements, body-fat estimate and progress photos.
 * Measurements are stored in cm (shown in inches when the unit is lb). Photos live in IndexedDB only.
 */
(() => {
'use strict';
const K = window.K;
const { esc, fmt, r1, icon, num, uid, clamp } = K;
const PARTS = [['waist', 'Waist'], ['neck', 'Neck'], ['hips', 'Hips'], ['chest', 'Chest'], ['arm', 'Upper arm'], ['thigh', 'Thigh']];
const POSES = [['front', 'Front'], ['side', 'Side'], ['back', 'Back view']];
const inch = () => K.unit() === 'lb';
const toD = cm => inch() ? cm / 2.54 : cm;
const fromD = v => inch() ? v * 2.54 : v;
const lu = () => inch() ? 'in' : 'cm';
const B = () => K.S.body || (K.S.body = {});

// US Navy tape method (Hodgdon & Beckett), all in cm. Typical error ±3–4 percentage points.
function navyBF(m) {
  const h = K.S.profile.heightCm, male = K.S.profile.sex === 'male';
  if (!m || !m.waist || !m.neck) return null;
  if (male) { if (m.waist - m.neck <= 0) return null; return 495 / (1.0324 - 0.19077 * Math.log10(m.waist - m.neck) + 0.15456 * Math.log10(h)) - 450; }
  if (!m.hips || m.waist + m.hips - m.neck <= 0) return null;
  return 495 / (1.29579 - 0.35004 * Math.log10(m.waist + m.hips - m.neck) + 0.22100 * Math.log10(h)) - 450;
}
const dates = () => Object.keys(B()).sort();
// latest value of each part on or before a date (people rarely measure everything every time)
function snapshot(upto) {
  const out = {};
  dates().filter(d => d <= upto).forEach(d => Object.assign(out, B()[d]));
  return out;
}

function openMeasure(k) {
  k = k || K.todayKey();
  const cur = B()[k] || {}, prev = snapshot(K.addDays(k, -1));
  const el = K.openSheet('Measurements', `
    <label class="field"><span>Date</span><input class="input" id="md" type="date" value="${k}" max="${K.todayKey()}"></label>
    <div class="grid2">${PARTS.map(([p, l]) => `<label class="field"><span>${l} (${lu()})</span><input class="input num" data-p="${p}" inputmode="decimal" value="${cur[p] ? r1(toD(cur[p])) : ''}" placeholder="${prev[p] ? r1(toD(prev[p])) : ''}"></label>`).join('')}</div>
    <p class="note">Measure in the morning with a soft tape, relaxed, at the same spots each time: waist at the navel, neck below the larynx, hips at the widest point. Waist and neck${K.S.profile.sex === 'male' ? '' : ' (and hips)'} give a body-fat estimate.</p>
    <div class="row-btns" style="margin-top:16px"><button class="btn block" id="msv">Save measurements</button></div>
    ${B()[k] ? '<div class="row-btns"><button class="btn block danger" id="mdl">Delete this day</button></div>' : ''}`);
  el.querySelector('#msv').onclick = () => {
    const d = el.querySelector('#md').value || k, rec = {};
    el.querySelectorAll('[data-p]').forEach(i => { const v = num(i.value); if (v > 0) rec[i.dataset.p] = Math.round(fromD(v) * 10) / 10; });
    if (!Object.keys(rec).length) { K.toast('Enter at least one measurement'); return; }
    if (d !== k) delete B()[k];
    B()[d] = rec; K.save(); K.closeSheet(); K.render(); K.toast('Measurements saved');
  };
  const del = el.querySelector('#mdl'); if (del) del.onclick = () => { delete B()[k]; K.save(); K.closeSheet(); K.render(); };
}

// ---------- photos ----------
function shrink(file) {
  return new Promise((ok, no) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280, sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = no; img.src = url;
  });
}
async function openPhotos() {
  const all = (await K.idb.all('photos')).sort((a, b) => a.date < b.date ? 1 : -1);
  const byDate = {}; all.forEach(p => (byDate[p.date] = byDate[p.date] || []).push(p));
  const ds = Object.keys(byDate);
  const el = K.openSheet('Progress photos', `
    <div class="row-btns" style="margin-top:0"><label class="btn sm">${icon('plus')}Add photo<input type="file" accept="image/*" id="ph" hidden></label>
      <select class="input" id="pose" style="width:auto;height:40px">${POSES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      ${ds.length > 1 ? `<button class="btn sm ghost" id="cmp">${icon('copy')}Compare</button>` : ''}</div>
    <p class="note">Same light, same spot, same time of day — morning works best. Photos stay on this phone and are included in your backups.</p>
    ${ds.length ? ds.map(d => `<h3 class="sub-h">${esc(K.niceDate(d, true))}</h3><div class="phgrid">${byDate[d].map(p => `<button class="ph" data-id="${p.id}"><img src="${p.img}" alt="${esc(p.pose)}"><span>${esc(K.tt(POSES.find(x => x[0] === p.pose)[1]))}</span></button>`).join('')}</div>`).join('')
      : '<div class="empty"><b>No photos yet</b>Take a front, side and back photo every 2–4 weeks. Changes you can’t see day to day show up clearly side by side.</div>'}`, { full: true });
  el.querySelector('#ph').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const img = await shrink(f);
      const rec = { id: 'p' + uid(), date: K.todayKey(), pose: el.querySelector('#pose').value, img };
      await K.idb.set(rec.id, rec, 'photos'); K.closeSheet(); openPhotos(); K.toast('Photo saved');
    } catch (err) { K.toast('That image could not be read'); }
  };
  el.addEventListener('click', async e => {
    const b = e.target.closest('.ph');
    if (b) {
      const p = all.find(x => x.id === b.dataset.id);
      const v = K.openSheet(K.niceDate(p.date, true), `<img class="phbig" src="${p.img}" alt=""><div class="row-btns"><button class="btn block danger" id="pdel">Delete photo</button></div>`, { full: true });
      v.querySelector('#pdel').onclick = async () => { if (!confirm(K.tt('Delete this photo?'))) return; await K.idb.del(p.id, 'photos'); K.closeAll(); openPhotos(); };
    }
    if (e.target.closest('#cmp')) compare(all, ds);
  });
}
function compare(all, ds) {
  let a = ds[ds.length - 1], b = ds[0], pose = 'front';
  const el = K.openSheet('Compare', '<div id="cmpb"></div>', { full: true });
  const draw = () => {
    const pick = d => all.find(p => p.date === d && p.pose === pose) || all.find(p => p.date === d);
    const sel = (id, v) => `<select class="input" id="${id}">${ds.map(d => `<option value="${d}" ${d === v ? 'selected' : ''}>${esc(K.niceDate(d, true))}</option>`).join('')}</select>`;
    const ma = snapshot(a), mb = snapshot(b), wa = K.model().byKey[a], wb = K.model().byKey[b];
    el.querySelector('#cmpb').innerHTML = `<div class="seg">${POSES.map(([v, l]) => `<button data-pose="${v}" aria-pressed="${pose === v}">${l}</button>`).join('')}</div>
      <div class="cmp"><div>${sel('ca', a)}${pick(a) ? `<img src="${pick(a).img}" alt="">` : ''}</div><div>${sel('cb', b)}${pick(b) ? `<img src="${pick(b).img}" alt="">` : ''}</div></div>
      <div class="card">${wa && wb ? `<div class="kv"><span>Trend weight</span><b class="num">${K.wFmt(wa.trend)} → ${K.wFmt(wb.trend)} ${K.unit()}</b></div>` : ''}
      ${ma.waist && mb.waist ? `<div class="kv"><span>Waist</span><b class="num">${r1(toD(ma.waist))} → ${r1(toD(mb.waist))} ${lu()}</b></div>` : ''}
      ${navyBF(ma) && navyBF(mb) ? `<div class="kv"><span>Body fat (estimate)</span><b class="num">${r1(navyBF(ma))} → ${r1(navyBF(mb))} %</b></div>` : ''}</div>`;
  };
  el.addEventListener('change', e => { if (e.target.id === 'ca') a = e.target.value; if (e.target.id === 'cb') b = e.target.value; draw(); });
  el.addEventListener('click', e => { const p = e.target.closest('[data-pose]'); if (p) { pose = p.dataset.pose; draw(); } });
  draw();
}

// ---------- progress card ----------
function bodyCard(range) {
  const ds = dates();
  const t = K.todayKey(), from = K.addDays(t, -Math.min(range, 3650));
  const last = snapshot(t), inRange = ds.filter(d => d >= from);
  const first = inRange.length ? snapshot(inRange[0]) : {};
  const bf = navyBF(last), bf0 = navyBF(first);
  let chartH = '';
  const pts = inRange.map(d => [d, navyBF(snapshot(d)), snapshot(d).waist]).filter(x => x[1] != null || x[2] != null);
  if (pts.length >= 2) {
    const days = K.model().days, i0 = Math.max(0, days.length - Math.min(range, days.length)), idx = d => K.diffDays(days[0].k, d);
    const bfp = pts.filter(x => x[1] != null).map(x => [idx(x[0]), x[1]]);
    const series = bfp.length >= 2 ? [{ pts: bfp, color: 'var(--brand)', width: 3 }, { pts: bfp, dots: true, color: 'var(--brand)', r: 3.5 }]
      : [{ pts: pts.map(x => [idx(x[0]), toD(x[2])]), color: 'var(--brand)', width: 3 }, { pts: pts.map(x => [idx(x[0]), toD(x[2])]), dots: true, color: 'var(--brand)', r: 3.5 }];
    const ys = series[0].pts.map(p => p[1]), pad = Math.max(0.5, (Math.max(...ys) - Math.min(...ys)) * 0.2);
    chartH = K.chart({ h: 140, series, xMin: Math.max(i0, series[0].pts[0][0]), xMax: days.length - 1, yMin: Math.min(...ys) - pad, yMax: Math.max(...ys) + pad, xLabels: K.xLabelsFor(days, Math.max(i0, series[0].pts[0][0]), days.length - 1) }) +
      `<p class="note" style="margin-top:4px">${bfp.length >= 2 ? K.tt('Body-fat estimate, %') : K.tt('Waist') + ', ' + lu()}</p>`;
  }
  const row = (l, v, d) => `<div class="stat" style="box-shadow:none;background:var(--surface-2)"><div class="k">${l}</div><div class="v num">${v}${d ? `<small> ${d}</small>` : ''}</div></div>`;
  const ch = (a, b2) => a != null && b2 != null && a !== b2 ? `${b2 - a > 0 ? '+' : ''}${r1(b2 - a)}` : '';
  return `<section class="card"><div class="card-h"><h2>Body</h2><a class="link" data-act="measure">Log measurements</a></div>
    ${ds.length ? `<div class="stats" style="margin-top:0">
      ${row(K.tt('Waist'), last.waist ? r1(toD(last.waist)) : '—', last.waist ? lu() + (first.waist ? ' ' + ch(r1(toD(first.waist)), r1(toD(last.waist))) : '') : '')}
      ${row(K.tt('Body fat'), bf != null ? r1(bf) : '—', bf != null ? '%' + (bf0 != null ? ' ' + ch(r1(bf0), r1(bf)) : '') : '')}
      ${row(K.tt('Measured'), String(ds.length), K.tt(ds.length === 1 ? 'time' : 'times'))}</div>${chartH}
      ${bf != null ? '<p class="note">US Navy tape estimate — usually within 3–4 % of a DEXA scan. The trend matters more than the number.</p>' : `<p class="note">Add waist and neck${K.S.profile.sex === 'male' ? '' : ' and hips'} to get a body-fat estimate.</p>`}`
      : '<p class="note" style="margin-top:0">Measurements show what the scale can’t: during a lean bulk, a steady waist while weight climbs means you’re adding muscle.</p>'}
    <div class="row-btns"><button class="btn sm" data-act="measure">${icon('plus')}Measurements</button><button class="btn sm ghost" data-act="photos">${icon('user')}Progress photos</button></div></section>`;
}

K.bodyCard = bodyCard;
Object.assign(K.actions, { measure: el => openMeasure(el.dataset.k), photos: () => openPhotos() });
window.KalibraBody = { navyBF };
})();
