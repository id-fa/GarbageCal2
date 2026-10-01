// 設定。保存先はこのブラウザの localStorage だけで、サーバーにもコードにも持たない。
// 他の端末へは JSON ファイルか「設定付きURL」（URLのハッシュに設定を埋め込んだもの）で渡す。

import { isDateKey } from './dates.js';
import { readJson, writeJson } from './storage.js';

const STORAGE_KEY = 'sgcal.settings';
const APPLIED_URL_KEY = 'sgcal.appliedUrlConfig';
const URL_PARAM = 'cfg';
const MAX_LIST_ITEMS = 50;

// カレンダー上の「今日」の目立たせ方。style.css の .today-<名前> と対応する
export const TODAY_STYLES = ['fill', 'outline', 'underline', 'circle', 'tint'];

export function defaultSettings() {
  return {
    version: 1,
    garbage: {
      enabled: false,
      // 日曜〜土曜の表示文言。空欄の曜日は noneText を表示する
      weekly: ['', '', '', '', '', '', ''],
      noneText: 'ゴミは出せません',
      // noneText を大きい文字で表示する
      noneTextLarge: false,
      // 第n○曜日のルール: { weekday, weeks: [1..5], text, offText }
      rules: [],
      // 収集休み期間: { from, to, yearly, label }
      closures: [],
    },
    // { text, until }  until の日まで表示（空なら常に表示）
    memos: [],
    display: {
      // 「第n○曜日」と表示する曜日（0=日 … 6=土）
      nthWeekdays: [6],
      showHeisei: true,
      showShowa: true,
      todayStyle: 'fill',
      // この時刻までは日付が変わっていても「明日（…今日）」と表現する
      midnightHour: 4,
      // この時刻から明日の情報を表示する
      tomorrowFromHour: 12,
      // この時刻まで今日のごみ情報を表示する
      garbageTodayUntilHour: 11,
    },
  };
}

const text = (value, maxLength) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const int = (value, min, max, fallback) =>
  Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const list = (value) => (Array.isArray(value) ? value.slice(0, MAX_LIST_ITEMS) : []);
const intSet = (value, min, max) =>
  [...new Set(list(value).filter((v) => Number.isInteger(v) && v >= min && v <= max))].sort(
    (a, b) => a - b,
  );

// 外から来た値（保存データ・インポート・URL）を、欠けや不正を既定値で埋めた設定にする
export function normalizeSettings(raw) {
  const defaults = defaultSettings();
  const garbage = raw?.garbage ?? {};
  const display = raw?.display ?? {};

  return {
    version: 1,
    garbage: {
      enabled: bool(garbage.enabled, defaults.garbage.enabled),
      weekly: defaults.garbage.weekly.map((_, i) => text(garbage.weekly?.[i], 40)),
      noneText: text(garbage.noneText, 40) || defaults.garbage.noneText,
      noneTextLarge: bool(garbage.noneTextLarge, defaults.garbage.noneTextLarge),
      rules: list(garbage.rules)
        .map((rule) => ({
          weekday: int(rule?.weekday, 0, 6, 0),
          weeks: intSet(rule?.weeks, 1, 5),
          text: text(rule?.text, 40),
          offText: text(rule?.offText, 40),
        }))
        .filter((rule) => rule.text),
      closures: list(garbage.closures)
        .map((closure) => {
          // 片方しか入力されていなければ1日だけの休みとして扱う
          const from = isDateKey(closure?.from) ? closure.from : closure?.to;
          const to = isDateKey(closure?.to) ? closure.to : from;
          const yearly = bool(closure?.yearly, false);
          const swap = !yearly && from > to;
          return {
            from: swap ? to : from,
            to: swap ? from : to,
            yearly,
            label: text(closure?.label, 20),
          };
        })
        .filter((closure) => isDateKey(closure.from) && isDateKey(closure.to)),
    },
    memos: list(raw?.memos)
      .map((memo) => ({
        text: text(memo?.text, 300),
        until: isDateKey(memo?.until) ? memo.until : '',
      }))
      .filter((memo) => memo.text),
    display: {
      nthWeekdays: Array.isArray(display.nthWeekdays)
        ? intSet(display.nthWeekdays, 0, 6)
        : defaults.display.nthWeekdays,
      showHeisei: bool(display.showHeisei, defaults.display.showHeisei),
      showShowa: bool(display.showShowa, defaults.display.showShowa),
      todayStyle: TODAY_STYLES.includes(display.todayStyle)
        ? display.todayStyle
        : defaults.display.todayStyle,
      midnightHour: int(display.midnightHour, 0, 12, defaults.display.midnightHour),
      tomorrowFromHour: int(display.tomorrowFromHour, 0, 24, defaults.display.tomorrowFromHour),
      garbageTodayUntilHour: int(
        display.garbageTodayUntilHour,
        0,
        24,
        defaults.display.garbageTodayUntilHour,
      ),
    },
  };
}

export function loadSettings() {
  return normalizeSettings(readJson(STORAGE_KEY));
}

export function saveSettings(settings) {
  return writeJson(STORAGE_KEY, settings);
}

export function serializeSettings(settings) {
  return JSON.stringify(settings, null, 2);
}

// インポートされたJSON文字列を設定にする。設定として読めなければ例外を投げる。
export function parseSettingsJson(json) {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('設定ファイルの形式が正しくありません');
  }
  return normalizeSettings(raw);
}

// ---- 設定付きURL ----
// 形式は #cfg=z.<deflate圧縮したJSONのbase64url>。圧縮が使えないブラウザでは j.<JSONのbase64url>。
// ハッシュ部分はサーバーへ送信されないので、メモの内容がアクセスログに残らない。

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(encoded) {
  const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function transform(bytes, stream) {
  const transformed = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(transformed).arrayBuffer());
}

export async function encodeSettingsParam(settings) {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  if (typeof CompressionStream === 'undefined') return `j.${toBase64Url(bytes)}`;
  return `z.${toBase64Url(await transform(bytes, new CompressionStream('deflate-raw')))}`;
}

export async function decodeSettingsParam(param) {
  const format = param.slice(0, 2);
  let bytes = fromBase64Url(param.slice(2));
  if (format === 'z.') {
    bytes = await transform(bytes, new DecompressionStream('deflate-raw'));
  } else if (format !== 'j.') {
    throw new Error('未対応の形式です');
  }
  return parseSettingsJson(new TextDecoder().decode(bytes));
}

export async function buildSettingsUrl(settings, baseUrl) {
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = `${URL_PARAM}=${await encodeSettingsParam(settings)}`;
  return url.href;
}

// URLに設定が付いていれば取り込んで保存し、その設定を返す（無い・適用済み・壊れている場合は null）。
// 同じURLの設定は一度しか適用しない。ホームURLに設定したまま端末側で設定を編集しても、
// 次に開いたときにURLの内容で巻き戻らないようにするため。
export async function applySettingsFromUrl(hash) {
  const param = new URLSearchParams(hash.replace(/^#/, '')).get(URL_PARAM);
  if (!param || param === readJson(APPLIED_URL_KEY)) return null;
  try {
    const settings = await decodeSettingsParam(param);
    saveSettings(settings);
    writeJson(APPLIED_URL_KEY, param);
    return settings;
  } catch (error) {
    console.warn('URLの設定を読み込めませんでした', error);
    return null;
  }
}
