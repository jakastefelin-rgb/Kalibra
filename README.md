# Kalibra

Adaptive calorie and macro coach. Log food and weigh in; Kalibra measures your real energy
expenditure from intake vs. weight change and updates your targets at a weekly check-in.

- Single-page PWA, no build step, no server. Data is stored on the device (export/import in the app).
- Food data: USDA FoodData Central (built in) and Open Food Facts (online search + barcode).
- Lean bulk goal: gain rate by training experience (% body weight per month), maintenance + 5–10 % surplus,
  protein 0.7–1 g/lb, fat 20–30 %, weekly ±150 kcal adjustments from trend weight. Based on Jeff Nippard,
  "How To Bulk Like A Pro (Using Science)".
- Workouts: exercise library with top picks and setup cues (Will Tennyson ft. Jeff Nippard, "The Best Exercises
  For Every Muscle"), programs, live logging, rest timer, load/rep suggestions, "+1 rep" progress, swap by
  stretch / feel / overload, weekly sets per muscle, training-day calories.

## Run / deploy
Open `index.html` through any static web server, e.g. `python3 -m http.server`.
On GitHub: Settings → Pages → Deploy from branch `main`, folder `/ (root)`.
