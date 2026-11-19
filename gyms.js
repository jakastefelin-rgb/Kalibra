// Kalibra – gyms and equipment.
// Equipment people can tick for their gym, and what each exercise needs.
window.KAL_EQUIP = {
  barbell: 'Barbell and squat rack', dumbbells: 'Dumbbells', bench: 'Adjustable bench', smith: 'Smith machine',
  cable: 'Cable station / crossover', latpull: 'Lat pulldown', csrow: 'Chest-supported row machine', chestpress: 'Chest press machine',
  pecdeck: 'Pec deck / rear delt machine', shoulderpress: 'Shoulder press machine', legpress: 'Leg press', hacksquat: 'Hack squat',
  legext: 'Leg extension', seatedcurl: 'Seated leg curl', lyingcurl: 'Lying leg curl', calf: 'Calf raise machine',
  hip: 'Hip abduction / adduction machine', preacher: 'Preacher curl bench', pullupbar: 'Pull-up / dip station', cardio: 'Cardio machines',
};
// Exercise id → equipment it needs (all of them). Exercises not listed need nothing.
window.KAL_EX_NEEDS = {
  bench: ['barbell', 'bench'], inclinebench: ['barbell', 'bench'], dbbench: ['dumbbells', 'bench'], dbincline: ['dumbbells', 'bench'], chestpress: ['chestpress'],
  dbfly: ['dumbbells', 'bench'], cablefly: ['cable'], pecdeck: ['pecdeck'], dips: ['pullupbar'],
  deadlift: ['barbell'], bbrow: ['barbell'], dbrow: ['dumbbells', 'bench'], csrow: ['csrow'], tbarrow: ['barbell'], seatedrow: ['cable'],
  pullup: ['pullupbar'], chinup: ['pullupbar'], latpulldown: ['latpull'], npulldown: ['latpull'], sapulldown: ['cable'], facepull: ['cable'], shrug: ['dumbbells'],
  ohp: ['barbell'], dbpress: ['dumbbells', 'bench'], machinepress: ['shoulderpress'], lateral: ['dumbbells'], cablelateral: ['cable'],
  reardeltfly: ['dumbbells'], revpecdeck: ['pecdeck'], revpecdeck1: ['pecdeck'],
  bbcurl: ['barbell'], dbcurl: ['dumbbells'], hammercurl: ['dumbbells'], inclinecurl: ['dumbbells', 'bench'], preacher: ['preacher'], cablecurl: ['cable'], bayesian: ['cable'],
  pushdown: ['cable'], ohext: ['cable'], kickback: ['cable'], skull: ['barbell', 'bench'], cgbench: ['barbell', 'bench'], wristcurl: ['dumbbells'],
  squat: ['barbell'], frontsquat: ['barbell'], smithsquat: ['smith'], hacksquat: ['hacksquat'], legpress: ['legpress'], bss: ['dumbbells', 'bench'], lunge: ['dumbbells'],
  stepup: ['dumbbells', 'bench'], legext: ['legext'], rdl: ['barbell'], dbrdl: ['dumbbells'], lyingcurl: ['lyingcurl'], seatedcurl: ['seatedcurl'],
  hipthrust: ['barbell', 'bench'], abductor: ['hip'], adductor: ['hip'], calfraise: ['calf'], seatedcalf: ['calf'],
  hlr: ['pullupbar'], cablecrunch: ['cable'],
  run: ['cardio'], jog: ['cardio'], walkincline: ['cardio'], bike: ['cardio'], row: ['cardio'], stairs: ['cardio'], elliptical: ['cardio'],
};
// Presets to start a checklist from. "Typical full gym" is a guess, not a survey of a specific gym.
window.KAL_EQUIP_PRESETS = {
  full: ['barbell', 'dumbbells', 'bench', 'smith', 'cable', 'latpull', 'csrow', 'chestpress', 'pecdeck', 'shoulderpress', 'legpress', 'hacksquat', 'legext', 'seatedcurl', 'lyingcurl', 'calf', 'hip', 'preacher', 'pullupbar', 'cardio'],
  typical: ['barbell', 'dumbbells', 'bench', 'smith', 'cable', 'latpull', 'chestpress', 'pecdeck', 'legpress', 'legext', 'lyingcurl', 'calf', 'pullupbar', 'cardio'],
  home: ['dumbbells', 'bench', 'pullupbar'],
};

// Gyms in Kranj and the rest of Gorenjska. Only facts found in public listings (checked November 2026).
// No gym publishes a machine-by-machine list, so `confirmed` holds only equipment the sources name;
// people tick the rest themselves. Call the gym to confirm details before relying on them.
window.KAL_GYMS = [
  { id: 'prosport', name: 'Prošport', town: 'Kranj', address: 'Jernejeva ulica 12, 4000 Kranj', size: '300 m²', brand: 'Technogym',
    hours: 'Open 24/7', extras: ['Sauna', 'Separate cardio, weights and machine zones'], phone: '+386 31 362 629', email: 'info@prosport.si', web: 'https://prosport.si/',
    confirmed: ['cardio'], note: 'Has a free-weights zone; specific machines are not listed publicly.' },
  { id: 'vital', name: 'Vital Center', town: 'Kranj', address: 'Ljubljanska cesta 29A, 4000 Kranj', size: '500–600 m²', brand: 'Not stated',
    hours: 'Check with the gym', extras: ['CrossFit hall', 'Squash court', 'Sauna', 'Free parking'], phone: '051 810 772', email: 'info@vitalcenter.si', web: 'https://vitalcenter.si/',
    confirmed: ['dumbbells', 'cardio'], note: 'A directory listing claims 60+ machines and 8 t of weights (third-party figure). Free weights, treadmills and bikes are confirmed by a review on the gym’s site.' },
  { id: 'megakranj', name: 'Mega Center Kranj', town: 'Kranj', address: 'Savska cesta 34, 4000 Kranj', size: '530 m²', brand: 'Technogym',
    hours: 'Check with the gym', extras: ['Cardio and isotonic machine areas', 'Mirrored walls'], phone: '', email: '', web: '',
    confirmed: ['cardio'], note: 'Most machines are Technogym according to reviews.' },
  { id: 'king', name: 'Fitnes King', town: 'Kranj', address: 'Cesta Staneta Žagarja 71, 4000 Kranj', size: '400 m²', brand: 'Technogym',
    hours: 'Open 24/7', extras: ['Small private room with a punching bag'], phone: '', email: '', web: '',
    confirmed: [], note: 'Equipped with Technogym machines; specific machines are not listed publicly.' },
  { id: 'top', name: 'Fitness Center Top', town: 'Lesce', address: 'Hraška cesta 19, 4248 Lesce', size: '40 machines, 12 of them cardio', brand: 'Not stated',
    hours: 'Every day 5:00–24:00 (one directory says 9:00–21:00 — check)', extras: ['Cardio, strength and functional areas', 'Personal trainers', 'Day pass 10 €, month 55 € (older price list)'],
    phone: '040 386 977', email: 'info@fitnestop.si', web: 'https://fitnestop.si/',
    confirmed: ['dumbbells', 'cardio'], note: 'Free weights confirmed; closest larger gym to Radovljica and Bled.' },
  { id: 'lux', name: 'Lux Fitnes', town: 'Škofja Loka', address: 'Poljanska cesta 4, 4220 Škofja Loka', size: 'Not stated', brand: 'Not stated',
    hours: 'Check with the gym', extras: ['Weightlifting and powerlifting', 'Personal training', 'Nutrition advice'], phone: '+386 31 735 330', email: 'info@luxfitnes.si', web: 'https://www.luxfitnes.si/',
    confirmed: ['barbell', 'dumbbells', 'cardio'], note: 'The gym lists free weights, a range of Olympic bars, strength machines and endurance machines.' },
  { id: 'biofit', name: 'Bio-Fit', town: 'Bled', address: 'Koritno 6, Bled', size: 'Not stated', brand: 'Not stated', hours: 'Check with the gym', extras: [], phone: '', email: '', web: '',
    confirmed: [], note: 'Listed in a gym directory; no equipment details published.' },
  { id: 'n1bled', name: 'N1 Fitness Bled', town: 'Bled', address: 'Bled', size: 'Not stated', brand: 'Not stated', hours: 'Check with the gym', extras: [], phone: '', email: '', web: '',
    confirmed: [], note: 'Listed in a gym directory; no equipment details published.' },
];
