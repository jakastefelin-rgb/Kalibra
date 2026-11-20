# Kalibra

Adaptive nutrition and training coach. Log food and weigh in; Kalibra measures your real energy expenditure
from intake vs. trend weight and updates your targets at a weekly check-in. English and Slovenian.

**Live:** https://jakastefelin-rgb.github.io/kalibra/

## What's inside
- **Coaching:** adaptive expenditure (skips water-shift days after a phase start, flags under-logged days),
  lose / maintain / lean bulk goals, weekly check-ins, training-day calorie shifting.
- **Food:** ~12,400 foods offline — hand-picked basics, USDA FoodData Central SR Legacy (public domain) and
  products sold in Slovenia from Open Food Facts (ODbL); online search with Spar / Hofer / Lidl / Mercator filters;
  barcode scanner; meals, recipes, favourites, multi-select; sugars, saturated fat, salt, vitamins and minerals.
- **Training:** programs, live logging, rest timer, load/rep suggestions, “+1 rep” progress, supersets, plate
  calculator, deload weeks, weekly report, gym equipment filter, swaps by stretch / feel / overload.
- **Body:** measurements, US Navy body-fat estimate, progress photos (on device) with comparison.
- **Safety:** data on device in localStorage plus an IndexedDB copy, persistent-storage request, share-sheet
  backups, weekly reminders, calendar (.ics) reminders.
- **Android app:** Capacitor wrapper that reads steps from Health Connect (`android/`).

## Develop
No build step for the website — serve the folder with any static server.

```bash
npm install
npm test               # 24 browser tests (Playwright)
npm run android:sync   # copy the app into the Android project
cd android && ./gradlew assembleDebug
```
GitHub Actions runs the tests and builds a debug APK on every push. See `docs/PHONE-CHECKLIST.md` for checks
that need a real phone.

## Sources
Bulking guidance: Jeff Nippard, “How To Bulk Like A Pro (Using Science)”. Exercise picks: Will Tennyson ft.
Jeff Nippard, “The Best Exercises For Every Muscle”. General information, not medical advice.
