// Data safety, body tracking, reminders and language.
'use strict';
const fs = require('fs');
module.exports = {
  async 'data is restored from the second copy when localStorage is wiped'(page, { base, onboard, assert, wait }) {
    await onboard(page, base); await wait(page, 700);
    await page.evaluate(() => localStorage.clear()); await page.reload(); await wait(page, 1200);
    assert.ok(await page.evaluate(() => !!K.S.profile), 'profile restored');
  },
  async 'backup file contains data and clears the reminder'(page, { base, onboard, assert, wait }) {
    await onboard(page, base);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => K.actions.export())]);
    const data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.ok(data.profile && Array.isArray(data.photos));
    assert.strictEqual(await page.evaluate(() => K.S.settings.lastBackup), await page.evaluate(() => K.todayKey()));
  },
  async 'body-fat estimate follows the US Navy formula'(page, { base, onboard, assert }) {
    await onboard(page, base, { sex: 'male', height: 180 });
    assert.strictEqual(await page.evaluate(() => KalibraBody.navyBF({ waist: 85.5, neck: 38 }).toFixed(1)), '16.5');
  },
  async 'reminder calendar file is valid'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base);
    await page.evaluate(() => { K.S.train.days = [1, 3, 5]; K.save(); });
    await page.click('[data-act=view][data-v=profile] >> nth=0'); await wait(page); await page.click('[data-act=reminders]'); await wait(page);
    await top().locator('[data-rk=train]').check();
    const [dl] = await Promise.all([page.waitForEvent('download'), top().locator('#remgo').click()]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(ics, /BEGIN:VCALENDAR\r\n/); assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR/);
    assert.ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75), 'lines folded');
  },
  async 'Slovenian mode leaves no English on the main screens'(page, { base, onboard, assert, wait }) {
    await onboard(page, base, { lang: 'sl' });
    const english = /\b(the|your|today|left|over|weight|food|workout|calories|protein|carbs|expenditure|target|log|add|edit|save)\b/i;
    const leftovers = [];
    for (const v of ['today', 'train', 'progress', 'plan', 'profile']) {
      if (v === 'profile') await page.click('[data-act=view][data-v=profile] >> nth=0'); else await page.click(`.tab[data-v=${v}]`);
      await wait(page, 600);
      const texts = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.getElementById('main'), 4); let n; while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (t) out.push(t); } return out; });
      leftovers.push(...texts.filter(t => english.test(t) && !/Open Food Facts|USDA|Kalibra|MacroFactor|Nippard/.test(t)));
    }
    assert.deepStrictEqual(leftovers, []);
  },
};
module.exports['data saved by an older version loads on start (no second copy yet)'] = async (page, { base, onboard, assert, wait }) => {
  await onboard(page, base); await wait(page, 700);
  await page.evaluate(() => { K.S.train.templates.push({ id: 'tX', name: 'Kept', exercises: [] }); K.save(); });
  await page.evaluate(() => new Promise(ok => { const r = indexedDB.deleteDatabase('kalibra'); r.onsuccess = r.onerror = r.onblocked = () => ok(); }));
  await page.reload(); await wait(page, 1000);
  assert.ok(await page.evaluate(() => !!K.S.profile && K.S.train.templates.some(t => t.id === 'tX')), 'existing data must load from localStorage');
  assert.ok(await page.evaluate(() => !!document.getElementById('main')), 'app screen, not setup');
};
module.exports['changes made right before closing survive a reload'] = async (page, { base, onboard, assert, wait }) => {
  await onboard(page, base); await wait(page, 700);
  await page.evaluate(() => { K.S.train.templates.push({ id: 'tY', name: 'Last second', exercises: [] }); K.save(); });
  await page.reload(); await wait(page, 1000);
  assert.ok(await page.evaluate(() => K.S.train.templates.some(t => t.id === 'tY')));
  assert.notStrictEqual(await page.evaluate(() => document.getElementById('toast').textContent), 'Your data was restored from the backup copy');
};
