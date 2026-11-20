// Shared helpers for Kalibra tests.
'use strict';
const assert = require('assert');

const wait = (page, ms = 400) => page.waitForTimeout(ms);
const top = page => page.locator('.sheet.on').last();

// Go through setup. opts: { lang, sex, weight, height, goal: 'lose'|'maintain'|'bulk', unit }
async function onboard(page, base, opts = {}) {
  await page.goto(base);
  if (opts.lang) await page.click(`[data-act=ob-lang][data-v=${opts.lang}]`);
  await page.click('[data-act=ob-next]');
  if (opts.unit === 'lb') await page.click('[data-k=unit][data-v=lb]');
  await page.fill('[data-ob=birthYear]', String(opts.birthYear || 1994));
  await page.click(`[data-k=sex][data-v=${opts.sex || 'male'}]`);
  await page.click('[data-act=ob-next]');
  if (opts.unit === 'lb') { await page.fill('[data-ob=ft]', '5'); await page.fill('[data-ob=inch]', '11'); }
  else await page.fill('[data-ob=height]', String(opts.height || 180));
  await page.fill('[data-ob=weight]', String(opts.weight || 80));
  await page.click('[data-act=ob-next]');
  await page.click('[data-act=ob-next]');
  if (opts.goal) await page.click(`[data-k=type][data-v=${opts.goal}]`);
  for (let i = 0; i < 3; i++) { await page.click('[data-act=ob-next]'); await wait(page, 120); }
  await wait(page, 500);
}
// Seed synthetic history: N days of intake and weight with a known true expenditure.
function seedHistory(page, { days = 56, tdee = 2900, eat = 2400, noise = 250, scaleNoise = 0.6, start = 90, seed = 7, water = 0 } = {}) {
  return page.evaluate(o => {
    const S = K.S, t = K.todayKey(), st = K.addDays(t, -o.days + 1);
    S.profile.start = st; S.phases = [st]; S.checkins[0].date = st; S.weights = {}; S.logs = {}; S.incomplete = {};
    let seed = o.seed; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const g = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return s - 3; };
    let w = o.start;
    for (let i = 0; i < o.days; i++) {
      const k = K.addDays(st, i), e = o.eat + g() * o.noise; w += (e - o.tdee) / 7700;
      const wat = -o.water * Math.min(1, i / 6);
      if (rnd() < 0.85) S.weights[k] = Math.round((w + wat + g() * o.scaleNoise) * 10) / 10;
      S.logs[k] = [{ id: 'x' + i, t: +K.pkey(k) + 432e5, name: 'Seed', kcal: Math.round(e), p: 150, c: 250, f: 80, fib: 25, quick: true }];
    }
    K.save();
    return w;
  }, { days, tdee, eat, noise, scaleNoise, start, seed, water });
}
module.exports = { assert, wait, top, onboard, seedHistory };
