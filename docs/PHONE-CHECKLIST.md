# Kalibra — check on a real phone

Automated tests cover the logic in a desktop browser. These things can only be confirmed on a real phone.
Takes about 10 minutes. Note anything that fails and what you saw.

## iPhone (Safari)

1. **Add to Home Screen** — open the site in Safari → Share → *Add to Home Screen*. Open Kalibra from the new icon.
   It should open full-screen, without the Safari address bar.
2. **Barcode scanner** — + → Log food → Scan. Allow the camera. Point at any packaged food.
   Expect: the product opens within a few seconds (e.g. a Ljubljanske mlekarne yogurt works offline).
3. **Online search** — Log food → Online → pick *Lidl* with an empty search box. Expect a list of products.
4. **Backup** — You (person icon) → *Back up now*. The share sheet should open → save to *Files*.
5. **Reminders** — You → Reminders → *Add to my calendar*. Expect the Calendar app to offer to add the events.
6. **Progress photo** — Progress → Progress photos → Add photo → take one. It should appear in the list.
7. **Update banner** — after a new version goes live, open the app: a green *“Kalibra was updated”* banner appears; tap it.

## Android (Chrome)

1. Open the site → menu ⋮ → *Install app* (or *Add to Home screen*).
2. Repeat steps 2–7 above (the backup share sheet can save to Google Drive).

## Android app (APK with steps)

1. On GitHub: **Actions → Android app → newest run → Artifacts → kalibra-android-debug**, download and unzip.
2. Copy `app-debug.apk` to the phone and open it (allow “install unknown apps” for your browser/files app).
3. Open Kalibra → Today → *Show your steps* → allow **Steps** in Health Connect.
   Expect: “… steps today” and a 7-day average. If Health Connect is missing, the card offers to install it.
4. The barcode scanner should ask for camera permission and work like in the browser.

Data in the APK is separate from the browser version — use *Back up now* in one and *Restore backup* in the other to move it.

## iPhone app with Apple Health

Needs a Mac with Xcode and an Apple Developer account (99 $/year) to sign and install. The project is ready for it:
`npm install && npx cap add ios`, then enable the HealthKit capability in Xcode.
