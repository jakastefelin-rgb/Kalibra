// Energy model, targets, check-ins and lean bulk.
'use strict';
module.exports = {
  async 'expenditure converges to the true value from a wrong start'(page, { base, onboard, seedHistory, assert }) {
    await onboard(page, base);
    for (const [init, seed] of [[2300, 3], [3500, 11]]) {
      await page.evaluate(i => { K.S.init = i; }, init);
      await seedHistory(page, { seed, tdee: 2900 });
      const E = await page.evaluate(() => { const m = K.model(); return Math.round(m.days[m.days.length - 1].E); });
      assert.ok(Math.abs(E - 2900) < 200, `start ${init}: ended at ${E}, expected ~2900`);
    }
  },
  async 'water drop at a diet start does not inflate expenditure'(page, { base, onboard, seedHistory, assert }) {
    await onboard(page, base);
    await page.evaluate(() => { K.S.init = 2900; });
    await seedHistory(page, { seed: 3, water: 1.5 });
    const max = await page.evaluate(() => Math.max(...K.model().days.map(d => d.E)));
    assert.ok(max < 3150, `peak estimate ${Math.round(max)} — water shift leaked into expenditure`);
  },
  async 'trend weight tracks the true weight closely'(page, { base, onboard, seedHistory, assert }) {
    await onboard(page, base);
    const truth = await seedHistory(page, { seed: 5 });
    const trend = await page.evaluate(() => { const m = K.model(); return m.days[m.days.length - 1].trend; });
    assert.ok(Math.abs(trend - truth) < 0.5, `trend ${trend.toFixed(2)} vs true ${truth.toFixed(2)}`);
  },
  async 'lean bulk: maintenance from body weight and capped weekly adjustment'(page, { base, onboard, assert, wait }) {
    await onboard(page, base, { goal: 'bulk', weight: 77.1 });
    const c0 = await page.evaluate(() => K.S.checkins[0]);
    const expect = Math.round(77.1 * 2.2046226218 * 15 * 1.075 / 5) * 5; // light activity ×15, intermediate +7.5 %
    assert.strictEqual(c0.kcal, expect, 'starting bulk calories');
    await page.evaluate(() => {
      const S = K.S, t = K.todayKey(), st = K.addDays(t, -8);
      S.profile.start = st; S.phases = [st]; S.checkins[0].date = st; S.weights = {}; S.logs = {};
      for (let i = 0; i <= 8; i++) { const k = K.addDays(t, -8 + i); S.weights[k] = 77.1 + 0.6 / 7 * i; S.logs[k] = [{ id: 'a' + i, t: 0, name: 'x', kcal: 3000, p: 150, c: 350, f: 80 }]; }
      K.save();
    });
    await page.click('.tab[data-v=plan]'); await wait(page);
    await page.click('[data-act=checkin]'); await wait(page);
    await page.locator('#ca').click(); await wait(page);
    const c1 = await page.evaluate(() => K.S.checkins[K.S.checkins.length - 1]);
    assert.ok(c1.adj < 0 && c1.adj >= -150, `gaining too fast should lower calories by at most 150, got ${c1.adj}`);
  },
  async 'training-day calories keep the weekly total'(page, { base, onboard, assert }) {
    await onboard(page, base);
    const r = await page.evaluate(() => {
      K.S.train.days = [1, 3, 5]; K.S.train.shift = 0.15; K.save();
      let sum = 0; const t = K.todayKey(); for (let i = 0; i < 7; i++) sum += K.targetsOn(K.addDays(t, i)).kcal;
      return { sum, base: K.S.checkins[0].kcal * 7 };
    });
    assert.ok(Math.abs(r.sum - r.base) <= 7, `weekly ${r.sum} vs ${r.base}`);
  },
};
