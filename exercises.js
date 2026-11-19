// Kalibra – exercise library.
// Columns: id, name, primary muscle, secondary muscles (comma list), equipment, kind
// kind: 'w' = weight × reps, 'bw' = bodyweight reps (optional added weight), 't' = timed hold, 'c' = cardio (minutes + MET)
window.KAL_MUSCLES = {
  chest: 'Chest', lats: 'Lats', upperback: 'Upper back', traps: 'Traps', frontdelt: 'Front delts', sidedelt: 'Side delts',
  reardelt: 'Rear delts', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Forearms', quads: 'Quads', hamstrings: 'Hamstrings',
  glutes: 'Glutes', adductors: 'Adductors', calves: 'Calves', abs: 'Abs', lowerback: 'Lower back', cardio: 'Cardio',
};
window.KAL_EXERCISES = [
  // Chest
  ['bench', 'Bench press', 'chest', 'triceps,frontdelt', 'Barbell', 'w'],
  ['inclinebench', 'Incline bench press', 'chest', 'frontdelt,triceps', 'Barbell', 'w'],
  ['dbbench', 'Dumbbell bench press', 'chest', 'triceps,frontdelt', 'Dumbbell', 'w'],
  ['dbincline', 'Incline dumbbell press', 'chest', 'frontdelt,triceps', 'Dumbbell', 'w'],
  ['chestpress', 'Machine chest press', 'chest', 'triceps,frontdelt', 'Machine', 'w'],
  ['dbfly', 'Dumbbell fly', 'chest', '', 'Dumbbell', 'w'],
  ['cablefly', 'Cable crossover', 'chest', '', 'Cable', 'w'],
  ['pecdeck', 'Pec deck', 'chest', '', 'Machine', 'w'],
  ['dips', 'Dips', 'chest', 'triceps,frontdelt', 'Bodyweight', 'bw'],
  ['pushup', 'Push-up', 'chest', 'triceps,frontdelt', 'Bodyweight', 'bw'],
  // Back
  ['deadlift', 'Deadlift', 'glutes', 'hamstrings,lowerback,upperback,traps,forearms', 'Barbell', 'w'],
  ['bbrow', 'Barbell row', 'upperback', 'lats,biceps,reardelt', 'Barbell', 'w'],
  ['dbrow', 'One-arm dumbbell row', 'lats', 'upperback,biceps', 'Dumbbell', 'w'],
  ['csrow', 'Chest-supported row', 'upperback', 'lats,reardelt,biceps', 'Machine', 'w'],
  ['tbarrow', 'T-bar row', 'upperback', 'lats,biceps', 'Barbell', 'w'],
  ['seatedrow', 'Seated cable row', 'upperback', 'lats,biceps', 'Cable', 'w'],
  ['pullup', 'Pull-up', 'lats', 'biceps,upperback', 'Bodyweight', 'bw'],
  ['chinup', 'Chin-up', 'lats', 'biceps', 'Bodyweight', 'bw'],
  ['latpulldown', 'Lat pulldown', 'lats', 'biceps,upperback', 'Cable', 'w'],
  ['sapulldown', 'Straight-arm pulldown', 'lats', '', 'Cable', 'w'],
  ['facepull', 'Face pull', 'reardelt', 'upperback,traps', 'Cable', 'w'],
  ['shrug', 'Dumbbell shrug', 'traps', 'forearms', 'Dumbbell', 'w'],
  ['backext', 'Back extension', 'lowerback', 'glutes,hamstrings', 'Bodyweight', 'bw'],
  // Shoulders
  ['ohp', 'Overhead press', 'frontdelt', 'triceps,sidedelt', 'Barbell', 'w'],
  ['dbpress', 'Seated dumbbell shoulder press', 'frontdelt', 'triceps,sidedelt', 'Dumbbell', 'w'],
  ['machinepress', 'Machine shoulder press', 'frontdelt', 'triceps,sidedelt', 'Machine', 'w'],
  ['lateral', 'Dumbbell lateral raise', 'sidedelt', '', 'Dumbbell', 'w'],
  ['cablelateral', 'Cable lateral raise', 'sidedelt', '', 'Cable', 'w'],
  ['reardeltfly', 'Rear delt fly', 'reardelt', 'upperback', 'Dumbbell', 'w'],
  ['revpecdeck', 'Reverse pec deck', 'reardelt', 'upperback', 'Machine', 'w'],
  // Arms
  ['bbcurl', 'Barbell curl', 'biceps', 'forearms', 'Barbell', 'w'],
  ['dbcurl', 'Dumbbell curl', 'biceps', 'forearms', 'Dumbbell', 'w'],
  ['hammercurl', 'Hammer curl', 'biceps', 'forearms', 'Dumbbell', 'w'],
  ['inclinecurl', 'Incline dumbbell curl', 'biceps', '', 'Dumbbell', 'w'],
  ['preacher', 'Preacher curl', 'biceps', '', 'Machine', 'w'],
  ['cablecurl', 'Cable curl', 'biceps', 'forearms', 'Cable', 'w'],
  ['pushdown', 'Triceps pushdown', 'triceps', '', 'Cable', 'w'],
  ['ohext', 'Overhead cable extension', 'triceps', '', 'Cable', 'w'],
  ['skull', 'Skull crusher', 'triceps', '', 'Barbell', 'w'],
  ['cgbench', 'Close-grip bench press', 'triceps', 'chest,frontdelt', 'Barbell', 'w'],
  ['wristcurl', 'Wrist curl', 'forearms', '', 'Dumbbell', 'w'],
  // Legs
  ['squat', 'Back squat', 'quads', 'glutes,adductors,lowerback', 'Barbell', 'w'],
  ['frontsquat', 'Front squat', 'quads', 'glutes,upperback', 'Barbell', 'w'],
  ['hacksquat', 'Hack squat', 'quads', 'glutes', 'Machine', 'w'],
  ['legpress', 'Leg press', 'quads', 'glutes,adductors', 'Machine', 'w'],
  ['bss', 'Bulgarian split squat', 'quads', 'glutes,adductors', 'Dumbbell', 'w'],
  ['lunge', 'Walking lunge', 'quads', 'glutes', 'Dumbbell', 'w'],
  ['stepup', 'Step-up', 'quads', 'glutes', 'Dumbbell', 'w'],
  ['legext', 'Leg extension', 'quads', '', 'Machine', 'w'],
  ['rdl', 'Romanian deadlift', 'hamstrings', 'glutes,lowerback', 'Barbell', 'w'],
  ['dbrdl', 'Dumbbell Romanian deadlift', 'hamstrings', 'glutes,lowerback', 'Dumbbell', 'w'],
  ['lyingcurl', 'Lying leg curl', 'hamstrings', 'calves', 'Machine', 'w'],
  ['seatedcurl', 'Seated leg curl', 'hamstrings', '', 'Machine', 'w'],
  ['hipthrust', 'Hip thrust', 'glutes', 'hamstrings', 'Barbell', 'w'],
  ['abductor', 'Hip abduction machine', 'glutes', '', 'Machine', 'w'],
  ['adductor', 'Hip adduction machine', 'adductors', '', 'Machine', 'w'],
  ['calfraise', 'Standing calf raise', 'calves', '', 'Machine', 'w'],
  ['seatedcalf', 'Seated calf raise', 'calves', '', 'Machine', 'w'],
  // Core
  ['plank', 'Plank', 'abs', '', 'Bodyweight', 't'],
  ['hlr', 'Hanging leg raise', 'abs', 'forearms', 'Bodyweight', 'bw'],
  ['cablecrunch', 'Cable crunch', 'abs', '', 'Cable', 'w'],
  ['abwheel', 'Ab wheel rollout', 'abs', 'lats', 'Bodyweight', 'bw'],
  // Cardio — last value is MET (Compendium of Physical Activities)
  ['run', 'Running (10 km/h)', 'cardio', '', 'Cardio', 'c', 9.8],
  ['jog', 'Jogging (8 km/h)', 'cardio', '', 'Cardio', 'c', 8.3],
  ['walkincline', 'Incline treadmill walk', 'cardio', '', 'Cardio', 'c', 6.0],
  ['walk', 'Brisk walk', 'cardio', '', 'Cardio', 'c', 4.3],
  ['bike', 'Stationary bike, moderate', 'cardio', '', 'Cardio', 'c', 6.8],
  ['row', 'Rowing machine, moderate', 'cardio', '', 'Cardio', 'c', 7.0],
  ['stairs', 'Stair climber', 'cardio', '', 'Cardio', 'c', 9.0],
  ['elliptical', 'Elliptical', 'cardio', '', 'Cardio', 'c', 5.0],
];

// Starter programs. Each day: [name, [[exerciseId, sets, repMin, repMax], ...]]
window.KAL_PROGRAMS = [
  ['Full body', '3 days a week · best for beginners and busy weeks', [
    ['Full body A', [['squat', 3, 5, 8], ['bench', 3, 6, 10], ['bbrow', 3, 8, 12], ['lateral', 2, 12, 20], ['hammercurl', 2, 10, 15]]],
    ['Full body B', [['rdl', 3, 6, 10], ['ohp', 3, 6, 10], ['latpulldown', 3, 8, 12], ['legpress', 2, 10, 15], ['pushdown', 2, 10, 15]]],
  ]],
  ['Upper / lower', '4 days a week · balanced strength and size', [
    ['Upper', [['bench', 3, 6, 10], ['csrow', 3, 8, 12], ['dbpress', 3, 8, 12], ['latpulldown', 3, 8, 12], ['dbcurl', 2, 10, 15], ['pushdown', 2, 10, 15]]],
    ['Lower', [['squat', 3, 5, 8], ['rdl', 3, 6, 10], ['legext', 2, 10, 15], ['lyingcurl', 2, 10, 15], ['calfraise', 3, 10, 15], ['hlr', 2, 10, 15]]],
  ]],
  ['Push / pull / legs', '3–6 days a week · high volume per muscle', [
    ['Push', [['bench', 3, 6, 10], ['dbincline', 3, 8, 12], ['dbpress', 2, 8, 12], ['lateral', 3, 12, 20], ['pushdown', 2, 10, 15], ['ohext', 2, 10, 15]]],
    ['Pull', [['pullup', 3, 6, 10], ['bbrow', 3, 8, 12], ['seatedrow', 2, 10, 15], ['facepull', 2, 12, 20], ['dbcurl', 2, 10, 15], ['hammercurl', 2, 10, 15]]],
    ['Legs', [['squat', 3, 5, 8], ['rdl', 3, 6, 10], ['legpress', 2, 10, 15], ['lyingcurl', 2, 10, 15], ['calfraise', 3, 10, 15]]],
  ]],
];
