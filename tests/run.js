// Kalibra test runner: serves the app from the repo root, runs every tests/*.test.js in a fresh browser
// context, and exits non-zero if anything fails. Run with `npm test`.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const only = process.argv[2];
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js') && (!only || f.includes(only))).sort();
  let failed = 0, passed = 0;
  for (const file of files) {
    const tests = require(path.join(__dirname, file));
    for (const [name, fn] of Object.entries(tests)) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, serviceWorkers: 'block' });
      // the app must never depend on the network for these tests
      await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort());
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      const t0 = Date.now();
      try {
        const h = require('./helpers');
        await fn(page, Object.assign({}, h, { base, top: () => h.top(page) }));
        if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
        passed++; console.log(`  ✓ ${file.replace('.test.js', '')} › ${name} (${Date.now() - t0} ms)`);
      } catch (e) {
        failed++; console.log(`  ✗ ${file.replace('.test.js', '')} › ${name}\n      ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')}`);
      }
      await ctx.close();
    }
  }
  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
