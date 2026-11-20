/* Kalibra — native app extras. Only active inside the Android app (Capacitor); does nothing on the website.
 * Reads daily steps from Health Connect (read-only, steps only) and shows them on Today.
 */
(() => {
'use strict';
const K = window.K;
const C = window.Capacitor;
const native = !!(C && C.isNativePlatform && C.isNativePlatform());
K.isNative = native;
if (!native) return;
const Health = C.registerPlugin ? C.registerPlugin('Health') : C.Plugins && C.Plugins.Health;
let steps = null, status = 'unknown';

async function refresh() {
  try {
    const { available } = await Health.isHealthAvailable();
    if (!available) { status = 'missing'; return; }
    const perm = await Health.checkHealthPermissions({ permissions: ['READ_STEPS'] });
    const ok = perm && perm.permissions && perm.permissions.some(p => p.READ_STEPS || p['READ_STEPS'] === true);
    if (!ok) { status = 'ask'; return; }
    const start = new Date(); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
    const { aggregatedData } = await Health.queryAggregated({ startDate: start.toISOString(), endDate: new Date().toISOString(), dataType: 'steps', bucket: 'day' });
    const byDay = {};
    (aggregatedData || []).forEach(d => { byDay[K.dkey(new Date(d.startDate))] = Math.round(d.value); });
    K.S.steps = Object.assign(K.S.steps || {}, byDay); K.save();
    steps = byDay; status = 'ok';
  } catch (e) { status = 'error'; }
}
function stepsCard(k) {
  if (k !== K.todayKey()) return '';
  if (status === 'missing') return `<button class="tcard" data-act="hc-install"><span class="ic">${K.icon('chart')}</span><span class="n"><b>${K.tt('Steps')}</b><span>${K.tt('Install Health Connect to show your steps')}</span></span>${K.icon('right')}</button>`;
  if (status === 'ask' || status === 'error') return `<button class="tcard" data-act="hc-connect"><span class="ic">${K.icon('chart')}</span><span class="n"><b>${K.tt('Show your steps')}</b><span>${K.tt('Connect Health Connect (read-only, steps only)')}</span></span>${K.icon('right')}</button>`;
  if (status !== 'ok') return '';
  const all = K.S.steps || {}, today = all[k] || 0;
  const week = Object.entries(all).filter(([d]) => d < k && d >= K.addDays(k, -7)).map(([, v]) => v);
  const avg = week.length ? Math.round(week.reduce((a, v) => a + v, 0) / week.length) : null;
  return `<div class="tcard"><span class="ic">${K.icon('chart')}</span><span class="n"><b>${K.fmt(today)} ${K.tt('steps today')}</b><span>${avg != null ? K.tt('7-day average') + ' ' + K.fmt(avg) + ' · ' : ''}${K.tt('Already counted in your expenditure')}</span></span></div>`;
}
K.stepsCard = stepsCard;
Object.assign(K.actions, {
  'hc-connect': async () => { try { await Health.requestHealthPermissions({ permissions: ['READ_STEPS'] }); } catch (e) {} await refresh(); K.render(); },
  'hc-install': async () => { try { await Health.showHealthConnectInPlayStore(); } catch (e) {} },
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().then(() => K.render()); });
refresh().then(() => K.render());
})();
