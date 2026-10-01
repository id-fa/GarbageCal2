// 日付ユーティリティ。日付は { y, m, d }（月は1始まり）のプレーンオブジェクトで扱い、
// 端末のタイムゾーンに左右されないよう計算はすべて UTC の Date を経由する。

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function fromUtc(t) {
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// エポックミリ秒を日本時間の年月日・時分に分解する
export function jstParts(epochMs) {
  const t = new Date(epochMs + JST_OFFSET_MS);
  return { ...fromUtc(t), hour: t.getUTCHours(), minute: t.getUTCMinutes() };
}

export function addDays(date, n) {
  return fromUtc(new Date(Date.UTC(date.y, date.m - 1, date.d + n)));
}

export function addMonths({ y, m }, n) {
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}

export function weekdayOf(date) {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// その月の何回目の曜日か（第n○曜日の n）
export function nthOfMonth(date) {
  return Math.ceil(date.d / 7);
}

export function dateKey({ y, m, d }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isDateKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
