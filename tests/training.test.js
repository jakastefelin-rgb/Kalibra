// Workouts: programs, progression, supersets, deloads, plates, gym equipment.
'use strict';
async function seedBench(page) {
  await page.evaluate(() => {
    const T = K.S.train, t = K.todayKey();
    const mk = (n, w, r) => { const d = K.addDays(t, -n), st = +K.pkey(d) + 36e6; return { id: 's' + n, date: d, start: st, end: st + 36e5, name: 'Upper', kcal: 250, exercises: [{ uid: 'u' + n, exId: 'bench', repMin: 6, repMax: 10, rir: 2, rest: 180, sets: [{ w, reps: r, done: true }, { w, reps: r, done: true }, { w, reps: r, done: true }] }] }; };
    T.sessions.push(mk(7, 80, 10));
    T.templates.push({ id: 'tA', name: 'Upper', exercises: [{ exId: 'bench', sets: 4, repMin: 6, repMax: 10, rest: 180 }, { exId: 'csrow', sets: 3, repMin: 8, repMax: 12, rest: 120 }] });
    K.save();
  });
}
module.exports = {
  async 'top of the rep range moves the load up by e1RM'(page, { base, onboard, assert, wait }) {
    await onboard(page, base); await seedBench(page);
    await page.click('.tab[data-v=train]'); await wait(page);
    await page.click('[data-act=tpl-start][data-id=tA] >> nth=0'); await wait(page, 700);
    assert.match(await page.locator('.xcard >> nth=0 >> .xhint').last().innerText(), /87\.5 kg × 6/);
  },
  async 'completing a set beats last time and starts the rest timer'(page, { base, onboard, assert, wait }) {
    await onboard(page, base); await seedBench(page);
    await page.click('.tab[data-v=train]'); await wait(page);
    await page.click('[data-act=tpl-start][data-id=tA] >> nth=0'); await wait(page, 700);
    await page.locator('.xcard >> nth=0 >> [data-f=w]').first().fill('80'); await page.locator('.xcard >> nth=0 >> [data-f=reps]').first().fill('11');
    await page.click('.xcard >> nth=0 >> .sc >> nth=0'); await wait(page);
    assert.strictEqual(await page.locator('.xcard >> nth=0 >> .srow').first().getAttribute('data-gain'), '+1 rep');
    assert.strictEqual(await page.locator('#rest.on').count(), 1);
  },
  async 'superset rests only after the second exercise'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base); await seedBench(page);
    await page.click('.tab[data-v=train]'); await wait(page);
    await page.click('[data-act=tpl-start][data-id=tA] >> nth=0'); await wait(page, 700);
    await page.click('[data-wa=ex-menu] >> nth=0'); await wait(page); await top().locator('#mss').check(); await top().locator('#msave').click(); await wait(page);
    await page.click('.xcard >> nth=0 >> .sc >> nth=0'); await wait(page);
    assert.strictEqual(await page.locator('#rest').count(), 0);
    await page.locator('.xcard >> nth=1 >> [data-f=w]').first().fill('50'); await page.locator('.xcard >> nth=1 >> [data-f=reps]').first().fill('10');
    await page.click('.xcard >> nth=1 >> .sc >> nth=0'); await wait(page);
    assert.strictEqual(await page.locator('#rest.on').count(), 1);
  },
  async 'deload week halves sets and lightens the load'(page, { base, onboard, assert, wait }) {
    await onboard(page, base); await seedBench(page);
    await page.click('.tab[data-v=train]'); await wait(page);
    await page.click('[data-act=deload-now]'); await wait(page);
    await page.click('[data-act=tpl-start][data-id=tA] >> nth=0'); await wait(page, 700);
    assert.strictEqual(await page.locator('.xcard >> nth=0 >> .srow').count(), 2);
    assert.match(await page.locator('.xcard >> nth=0 >> .xhint').last().innerText(), /70 kg/);
  },
  async 'plate calculator splits the load per side'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base); await seedBench(page);
    await page.click('.tab[data-v=train]'); await wait(page);
    await page.click('[data-act=tpl-start][data-id=tA] >> nth=0'); await wait(page, 700);
    await page.click('[data-wa=plates] >> nth=0'); await wait(page);
    await top().locator('#plt').fill('102.5'); await top().locator('#plt').dispatchEvent('change'); await wait(page, 200);
    assert.match(await top().locator('.kv').first().innerText(), /25 \+ 15 \+ 1\.25 kg/);
  },
  async 'programs adapt to the gym equipment'(page, { base, onboard, assert, wait }) {
    await onboard(page, base);
    await page.click('.tab[data-v=train]'); await wait(page);
    await page.click('[data-act=gym]'); await wait(page); await page.click('[data-g=top]'); await page.click('[data-preset=typical]'); await page.click('#gysave'); await wait(page);
    await page.click('[data-act=program]'); await wait(page); await page.click('[data-p="0"]'); await wait(page, 600);
    const ids = await page.evaluate(() => K.S.train.templates.flatMap(t => t.exercises.map(x => x.exId)));
    assert.ok(!ids.includes('seatedcurl') && ids.includes('lyingcurl') && !ids.includes('csrow'), ids.join(','));
  },
};
