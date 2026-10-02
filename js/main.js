// 起動処理と描画ループ

import { now, syncClock } from './clock.js';
import { addMonths, jstParts } from './dates.js';
import { loadBundledHolidays, refreshHolidays } from './holidays.js';
import {
  acceptUrlSettings,
  loadSettings,
  readUrlSettings,
  saveSettings,
  serializeSettings,
} from './settings.js';
import { setupSettingsDialog, setupUrlSettingsDialog } from './settings-ui.js';
import {
  applyTheme,
  createAnalogClock,
  digitalText,
  eraText,
  renderCalendar,
  renderInfo,
  renderMemos,
} from './view.js';

const MINUTE_MS = 60 * 1000;
const BACKGROUND_CHECK_INTERVAL_MS = 60 * MINUTE_MS;
// 別の月を表示したまま放置されたら今月に戻す
const VIEW_RESET_MS = 60 * MINUTE_MS;

const $ = (id) => document.getElementById(id);
const els = {
  monthTitle: $('month-title'),
  backToToday: $('back-to-today'),
  calendar: $('calendar'),
  era: $('era'),
  info: $('info'),
  digital: $('digital'),
  memos: $('memos'),
  fullscreen: $('fullscreen'),
};
const setAnalogClock = createAnalogClock($('analog'));
const urlSettingsDialog = setupUrlSettingsDialog($('url-settings-dialog'));

let settings = loadSettings();
// 表示中の月 { y, m }。null なら今月に追従する
let viewMonth = null;
let tickTimer = null;
let viewResetTimer = null;

function render() {
  const { hour, minute, ...today } = jstParts(now());
  const month = viewMonth ?? { y: today.y, m: today.m };

  applyTheme(settings.display.theme);
  els.monthTitle.textContent = `${month.y}年 ${month.m}月`;
  els.backToToday.hidden = viewMonth === null;
  renderCalendar(els.calendar, month, today, settings.display.todayStyle);
  els.era.textContent = eraText(month.y, settings.display);
  renderInfo(els.info, today, hour, settings);
  els.digital.textContent = digitalText(hour, minute);
  setAnalogClock(hour, minute);
  renderMemos(els.memos, settings.memos, today);
}

// 補正後の時刻で分が変わる瞬間に合わせて描画し直す
function scheduleTick() {
  clearTimeout(tickTimer);
  tickTimer = setTimeout(refresh, MINUTE_MS - (now() % MINUTE_MS) + 50);
}

function refresh() {
  render();
  scheduleTick();
}

function showMonth(month) {
  const today = jstParts(now());
  const isCurrent = month === null || (month.y === today.y && month.m === today.m);
  viewMonth = isCurrent ? null : month;
  clearTimeout(viewResetTimer);
  if (viewMonth) viewResetTimer = setTimeout(() => showMonth(null), VIEW_RESET_MS);
  render();
}

function shiftMonth(delta) {
  const today = jstParts(now());
  showMonth(addMonths(viewMonth ?? { y: today.y, m: today.m }, delta));
}

async function syncClockAndRefresh() {
  const ok = await syncClock();
  if (ok) refresh();
  return ok;
}

async function refreshHolidaysAndRender(options) {
  const updated = await refreshHolidays(now(), options);
  if (updated) render();
  return updated;
}

// 時刻の再同期と、古くなった祝日データの取り直し
async function backgroundCheck() {
  await syncClockAndRefresh();
  await refreshHolidaysAndRender();
}

// URLに未適用の設定が付いていれば、確認を取ってから取り込む
async function applyUrlSettings() {
  const pending = await readUrlSettings(location.hash);
  if (!pending) return;
  if (!pending.settings) {
    urlSettingsDialog.tooLong();
    return;
  }
  // いまの設定と同じ内容なら尋ねるまでもないので、適用済みとして記録だけする
  const unchanged = serializeSettings(pending.settings) === serializeSettings(settings);
  if (!unchanged && !(await urlSettingsDialog.confirm(pending.settings))) return;
  acceptUrlSettings(pending);
  settings = pending.settings;
  render();
}

function setupFullscreen() {
  if (!document.fullscreenEnabled) {
    els.fullscreen.hidden = true;
    return;
  }
  els.fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    els.fullscreen.textContent = document.fullscreenElement ? '全画面を解除' : '全画面';
  });
}

function init() {
  const settingsDialog = setupSettingsDialog({
    dialog: $('settings-dialog'),
    getSettings: () => settings,
    onSave: (next) => {
      settings = next;
      saveSettings(settings);
      render();
    },
    onSyncClock: syncClockAndRefresh,
    onRefreshHolidays: () => refreshHolidaysAndRender({ force: true }),
  });

  $('prev-month').addEventListener('click', () => shiftMonth(-1));
  $('next-month').addEventListener('click', () => shiftMonth(1));
  els.backToToday.addEventListener('click', () => showMonth(null));
  $('open-settings').addEventListener('click', () => settingsDialog.open());
  setupFullscreen();

  // まず手元の情報だけで表示し、サーバー時刻・祝日・URLの設定が届いたら描き直す
  refresh();
  applyUrlSettings();
  loadBundledHolidays().then((loaded) => loaded && render());
  backgroundCheck();

  setInterval(backgroundCheck, BACKGROUND_CHECK_INTERVAL_MS);
  window.addEventListener('online', backgroundCheck);
  window.addEventListener('hashchange', applyUrlSettings);
  // スリープ中はタイマーが止まるので、画面に戻ったら描き直して時刻も確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refresh();
    syncClockAndRefresh();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Service Worker を登録できませんでした', error);
    });
  }
}

init();
