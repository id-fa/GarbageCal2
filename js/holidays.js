// 祝日。参照の優先順位は
//   1. 自動取得して localStorage に保存したデータ
//   2. 同梱の syukujitsu.csv（内閣府CSVと同じ形式）
//   3. 現行の祝日法による計算（取得元が止まっても祝日が出続けるための保険）

import { addDays, dateKey, isDateKey, weekdayOf } from './dates.js';
import { readJson, writeJson } from './storage.js';

const SOURCE_URL = 'https://holidays-jp.github.io/api/v1/date.json';
const BUNDLED_URL = './syukujitsu.csv';
const STORAGE_KEY = 'sgcal.holidays';
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// { fetchedAt: エポックミリ秒 | null, years: { [年]: { 'YYYY-MM-DD': 祝日名 } } }
const fetched = loadFetched();
// { years: 同上, lastYear: 収録されている最後の年 }
let bundled = null;
const computedCache = new Map();

function loadFetched() {
  const saved = readJson(STORAGE_KEY);
  const years = saved?.years && typeof saved.years === 'object' ? saved.years : {};
  return { fetchedAt: Number.isFinite(saved?.fetchedAt) ? saved.fetchedAt : null, years };
}

export function holidayName(date) {
  const key = dateKey(date);
  if (fetched.years[date.y]) return fetched.years[date.y][key] ?? null;
  if (bundled && date.y <= bundled.lastYear) return bundled.years[date.y]?.[key] ?? null;
  return computeHolidays(date.y)[key] ?? null;
}

export function holidayStatus() {
  const years = Object.keys(fetched.years).map(Number).sort((a, b) => a - b);
  const count = years.reduce((sum, y) => sum + Object.keys(fetched.years[y]).length, 0);
  return { fetchedAt: fetched.fetchedAt, years, count };
}

// 同梱CSVを読み込む。読めたら true。
export async function loadBundledHolidays() {
  try {
    const res = await fetch(BUNDLED_URL);
    if (!res.ok) return false;
    const years = groupByYear(parseCsv(decodeCsv(await res.arrayBuffer())));
    const lastYear = Math.max(...Object.keys(years).map(Number));
    if (!Number.isFinite(lastYear)) return false;
    bundled = { years, lastYear };
    return true;
  } catch {
    return false;
  }
}

// 祝日データを取得し直す。force でなければ前回取得から一定期間は何もしない。
// データを更新できたら true。
export async function refreshHolidays(nowMs, { force = false } = {}) {
  const age = fetched.fetchedAt === null ? Infinity : nowMs - fetched.fetchedAt;
  // 端末時計の補正で fetchedAt が未来になっていた場合も取り直す
  if (!force && age >= 0 && age < REFRESH_INTERVAL_MS) return false;
  try {
    const res = await fetch(SOURCE_URL, { cache: 'no-cache' });
    if (!res.ok) return false;
    const years = groupByYear(parseApiResponse(await res.json()));
    // 年の途中までしか入っていないデータで「その年の残りは祝日なし」と誤判定しないよう、
    // 元日と勤労感謝の日が揃っている年だけ採用する
    const complete = Object.entries(years).filter(
      ([y, days]) => days[`${y}-01-01`] && days[`${y}-11-23`],
    );
    if (complete.length === 0) return false;
    for (const [y, days] of complete) fetched.years[y] = days;
    fetched.fetchedAt = nowMs;
    writeJson(STORAGE_KEY, fetched);
    return true;
  } catch {
    return false;
  }
}

function parseApiResponse(json) {
  if (!json || typeof json !== 'object') return [];
  return Object.entries(json)
    .filter(([key, name]) => isDateKey(key) && typeof name === 'string' && name)
    // 「天皇誕生日 振替休日」のような表記はカレンダーのマスに収まるよう短くする
    .map(([key, name]) => [key, name.endsWith('振替休日') ? '振替休日' : name.slice(0, 20)]);
}

// 内閣府の公式CSVは Shift_JIS なので、UTF-8 として読めなければ Shift_JIS で読む
function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

// 「2025/1/1,元日」形式の行を ['2025-01-01', '元日'] にする（ヘッダー行などは読み飛ばす）
function parseCsv(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.+)$/);
    if (!match) continue;
    const [, y, m, d, name] = match;
    entries.push([dateKey({ y: Number(y), m: Number(m), d: Number(d) }), name.trim()]);
  }
  return entries;
}

function groupByYear(entries) {
  const years = {};
  for (const [key, name] of entries) {
    (years[key.slice(0, 4)] ??= {})[key] = name;
  }
  return years;
}

// 現行の祝日法（2022年以降の内容）でその年の祝日を計算する
export function computeHolidays(year) {
  if (computedCache.has(year)) return computedCache.get(year);

  const nthMonday = (m, n) => {
    const firstWeekday = weekdayOf({ y: year, m, d: 1 });
    return 1 + ((8 - firstWeekday) % 7) + (n - 1) * 7;
  };
  // 春分・秋分の近似式（1980〜2099年で有効）
  const leapShift = Math.floor((year - 1980) / 4);
  const springEquinox = Math.floor(20.8431 + 0.242194 * (year - 1980)) - leapShift;
  const autumnEquinox = Math.floor(23.2488 + 0.242194 * (year - 1980)) - leapShift;

  const national = [
    [1, 1, '元日'],
    [1, nthMonday(1, 2), '成人の日'],
    [2, 11, '建国記念の日'],
    [2, 23, '天皇誕生日'],
    [3, springEquinox, '春分の日'],
    [4, 29, '昭和の日'],
    [5, 3, '憲法記念日'],
    [5, 4, 'みどりの日'],
    [5, 5, 'こどもの日'],
    [7, nthMonday(7, 3), '海の日'],
    [8, 11, '山の日'],
    [9, nthMonday(9, 3), '敬老の日'],
    [9, autumnEquinox, '秋分の日'],
    [10, nthMonday(10, 2), 'スポーツの日'],
    [11, 3, '文化の日'],
    [11, 23, '勤労感謝の日'],
  ].map(([m, d, name]) => ({ date: { y: year, m, d }, name }));

  const holidays = {};
  for (const { date, name } of national) holidays[dateKey(date)] = name;

  // 振替休日: 祝日が日曜なら、その後の最初の「祝日でない日」が休みになる
  for (const { date } of national) {
    if (weekdayOf(date) !== 0) continue;
    let substitute = addDays(date, 1);
    while (holidays[dateKey(substitute)]) substitute = addDays(substitute, 1);
    holidays[dateKey(substitute)] = '振替休日';
  }

  // 国民の休日: 前日と翌日がどちらも祝日の平日
  for (const { date } of national) {
    const between = addDays(date, 1);
    const isSandwiched = national.some((other) => dateKey(other.date) === dateKey(addDays(date, 2)));
    if (isSandwiched && !holidays[dateKey(between)] && weekdayOf(between) !== 0) {
      holidays[dateKey(between)] = '国民の休日';
    }
  }

  computedCache.set(year, holidays);
  return holidays;
}
