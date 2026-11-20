// Food search, databases, logging, meals, recipes and nutrients.
'use strict';
const openFood = async (page, wait) => { await page.click('[data-act=food] >> nth=0'); await wait(page, 1200); };
module.exports = {
  async 'big databases load and search in Slovenian and English'(page, { base, onboard, assert, wait }) {
    await onboard(page, base);
    await openFood(page, wait);
    const note = await page.locator('#fres .note').first().innerText();
    assert.match(note, /1[0-9],\d{3} foods on this phone/, note);
    for (const [q, want] of [['piščanec', /Chicken/], ['argeta', /Argeta/], ['alpski jogurt', /Alpski jogurt/], ['bananas, raw', /Bananas, raw/]]) {
      await page.fill('#fq', q); await wait(page, 500);
      const first = await page.locator('#fres .result .n b').first().innerText();
      assert.match(first, want, `${q} → ${first}`);
    }
  },
  async 'barcode lookup works offline for bundled products'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base);
    await openFood(page, wait);
    await page.click('[data-act=scan]'); await wait(page);
    await page.fill('#sc', '3838800062198'); await page.click('#sgo'); await wait(page, 800);
    assert.match(await top().locator('h3').innerText(), /Alpski jogurt/);
  },
  async 'logging a food adds correct calories and nutrients'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base);
    await openFood(page, wait);
    await page.fill('#fq', 'bananas, raw'); await wait(page, 500);
    await top().locator('#fres .result').first().click(); await wait(page);
    await top().locator('#du').selectOption('0'); await top().locator('#dq').fill('100'); await top().locator('#dq').dispatchEvent('input');
    await top().locator('#dsave').click(); await wait(page, 600);
    const e = await page.evaluate(() => K.S.logs[K.todayKey()][0]);
    assert.strictEqual(e.kcal, 89); assert.strictEqual(e.p, 1.1); assert.strictEqual(e.sug, 12.2); assert.strictEqual(e.k, 358);
  },
  async 'select several, save a meal and log it again'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base);
    await openFood(page, wait);
    await page.click('#selbtn');
    for (const q of ['banana', 'greek yogurt']) { await page.fill('#fq', q); await wait(page, 500); await page.click('#fres .result >> nth=0'); }
    await page.click('[data-act=sel-add]'); await wait(page, 600);
    assert.strictEqual(await page.locator('.entry').count(), 2);
    await page.click('[data-act=meal-save]'); await wait(page); await top().locator('#mn').fill('Breakfast'); await top().locator('#msave').click(); await wait(page);
    await page.click('[data-act=day][data-n="1"]'); await wait(page, 600);
    await openFood(page, wait); await page.click('[data-act=ftab][data-v=meals]'); await wait(page);
    await page.click('[data-act=meal-open]'); await wait(page); await top().locator('#mlog').click(); await wait(page, 600);
    assert.strictEqual(await page.locator('.entry').count(), 2);
  },
  async 'recipe per-portion values add up'(page, { base, onboard, assert, wait, top }) {
    await onboard(page, base);
    await openFood(page, wait); await page.click('[data-act=ftab][data-v=mine]'); await wait(page);
    await page.click('[data-act=recipe-new]'); await wait(page);
    await top().locator('#rn').fill('Bowl'); await top().locator('#rp').fill('2'); await top().locator('#rp').dispatchEvent('change');
    for (const [q, g] of [['chicken breast, skinless, roasted', '300'], ['white rice, cooked', '400']]) {
      await top().locator('#radd').click(); await wait(page, 900); await page.fill('#fq', q); await wait(page, 600);
      await top().locator('#fres .result').first().click(); await wait(page);
      await top().locator('#du').selectOption('0'); await top().locator('#dq').fill(g); await top().locator('#dq').dispatchEvent('input');
      await top().locator('#dsave').click(); await wait(page);
    }
    const per = await top().locator('.nutri b').allInnerTexts();
    assert.deepStrictEqual(per, ['508', '51.9', '56.4', '6'], 'per portion: ' + per.join('/'));
  },
  async 'online store search sends the right filters'(page, { base, onboard, assert, wait }) {
    const urls = [];
    await page.context().route('https://world.openfoodfacts.org/**', r => { urls.push(r.request().url()); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ products: [{ code: '1', product_name: 'Skyr', brands: 'Pilos', stores: 'Lidl', nutriments: { 'energy-kcal_100g': 63, proteins_100g: 11, carbohydrates_100g: 4, fat_100g: 0.2 } }] }) }); });
    await onboard(page, base);
    await openFood(page, wait); await page.click('[data-act=ftab][data-v=online]'); await wait(page);
    await page.click('[data-act=offstore][data-v=lidl]'); await wait(page, 700);
    assert.ok(urls.some(u => /tag_0=lidl/.test(u) && /tag_1=slovenia/.test(u)), urls.join('\n'));
    assert.match(await page.locator('#fres .result .n b').first().innerText(), /Skyr/);
  },
};
