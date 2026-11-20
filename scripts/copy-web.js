// Copy the static app into www/ for the native (Capacitor) build. The website itself needs no build step.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'www');
const files = ['index.html', 'i18n.js', 'app.js', 'foods.js', 'exercises.js', 'gyms.js', 'workouts.js', 'body.js', 'native.js', 'sw.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
const dirs = ['data', 'vendor'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const d of dirs) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
console.log('Copied app to www/');
