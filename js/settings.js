// 設定。保存先はこのブラウザの localStorage だけで、サーバーにもコードにも持たない。
// （写真だけは大きいので設定に含めず、photo.js が別に保存する）
// 他の端末へは JSON ファイルか「設定付きURL」（URLのハッシュに設定を埋め込んだもの）で渡す。

import { isDateKey } from './dates.js';
import { readJson, writeJson } from './storage.js';

const STORAGE_KEY = 'sgcal.settings';
const APPLIED_URL_KEY = 'sgcal.appliedUrlConfig';
const URL_PARAM = 'cfg';
// 設定付きURLに載せられる cfg の文字数。これを超える設定は JSON ファイルで渡してもらう。
// 受け取る側も同じ上限で弾くので、細工されたURLでも展開後のサイズは高々 1.5MB ほどに収まる。
const MAX_URL_PARAM_LENGTH = 2000;
const MAX_LIST_ITEMS = 50;

// カレンダー上の「今日」の目立たせ方。style.css の .today-<名前> と対応する
export const TODAY_STYLES = ['fill', 'outline', 'underline', 'circle', 'tint'];

// 配色テーマ。style.css の [data-theme='<名前>'] と対応する。auto は端末のライト／ダークに合わせる
export const THEMES = ['auto', 'light', 'dark', 'sepia', 'sepia-dark'];

// 写真に重ねる小さいカレンダーを置く隅（左下・右下）。style.css の [data-calendar-position='<名前>'] と対応する
export const PHOTO_CALENDAR_POSITIONS = ['left', 'right'];

// ---- ノート（見た目の設定だけ。本文は notes.js が別に保存する）----
// ノートに切り替えたとき置き換える範囲。style.css の .app[data-notes='<名前>'] と対応する
export const NOTE_AREAS = ['full', 'calendar', 'side'];
// 罫線。style.css の [data-note-rule='<名前>'] と対応する
export const NOTE_RULES = ['none', 'line', 'wave'];
// ノート用紙の配色。style.css の [data-note-theme='<名前>'] と対応する
export const NOTE_THEMES = ['light', 'dark', 'sepia'];
// 書体。style.css の [data-note-font='<名前>'] と対応する（Google Fonts から読み込む）
export const NOTE_FONTS = ['gothic', 'mincho', 'maru', 'hand'];
// 文字の大きさ。style.css の [data-note-size='<名前>'] と対応する。ノート画面のボタンでもこの順に切り替える
export const NOTE_SIZES = ['small', 'medium', 'large', 'xlarge'];

export function defaultSettings() {
  return {
    version: 1,
    garbage: {
      enabled: false,
      // 日曜〜土曜の表示文言。空欄の曜日は noneText を表示する
      weekly: ['', '', '', '', '', '', ''],
      // weekly の文言を大きい文字で表示する
      weeklyLarge: false,
      noneText: 'ゴミは出せません',
      // noneText を大きい文字で表示する
      noneTextLarge: false,
      // 大きい文字（weeklyLarge / noneTextLarge）をさらに大きくする
      extraLarge: false,
      // 第n○曜日のルール: { weekday, weeks: [1..5], text, offText }
      rules: [],
      // 収集休み期間: { from, to, yearly, label }
      closures: [],
    },
    // { text, until }  until の日まで表示（空なら常に表示）
    memos: [],
    // カレンダーを小さくして写真を表示する。写真そのものは設定に含めず、photo.js が IndexedDB に持つ
    photo: {
      enabled: false,
      calendarPosition: 'right',
    },
    // ノートの見た目。本文は設定に含めず、notes.js が localStorage の別のキーに持つ
    notes: {
      area: 'full',
      rule: 'line',
      theme: 'light',
      font: 'gothic',
      size: 'medium',
    },
    display: {
      theme: 'auto',
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
  const photo = raw?.photo ?? {};
  const notes = raw?.notes ?? {};
  const oneOf = (choices, value, fallback) => (choices.includes(value) ? value : fallback);

  return {
    version: 1,
    garbage: {
      enabled: bool(garbage.enabled, defaults.garbage.enabled),
      weekly: defaults.garbage.weekly.map((_, i) => text(garbage.weekly?.[i], 40)),
      weeklyLarge: bool(garbage.weeklyLarge, defaults.garbage.weeklyLarge),
      noneText: text(garbage.noneText, 40) || defaults.garbage.noneText,
      noneTextLarge: bool(garbage.noneTextLarge, defaults.garbage.noneTextLarge),
      extraLarge: bool(garbage.extraLarge, defaults.garbage.extraLarge),
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
    photo: {
      enabled: bool(photo.enabled, defaults.photo.enabled),
      calendarPosition: PHOTO_CALENDAR_POSITIONS.includes(photo.calendarPosition)
        ? photo.calendarPosition
        : defaults.photo.calendarPosition,
    },
    notes: {
      area: oneOf(NOTE_AREAS, notes.area, defaults.notes.area),
      rule: oneOf(NOTE_RULES, notes.rule, defaults.notes.rule),
      theme: oneOf(NOTE_THEMES, notes.theme, defaults.notes.theme),
      font: oneOf(NOTE_FONTS, notes.font, defaults.notes.font),
      size: oneOf(NOTE_SIZES, notes.size, defaults.notes.size),
    },
    display: {
      theme: THEMES.includes(display.theme) ? display.theme : defaults.display.theme,
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

// 設定付きURLを作る。設定が大きすぎてURLに載せられないときは null。
export async function buildSettingsUrl(settings, baseUrl) {
  const param = await encodeSettingsParam(settings);
  if (param.length > MAX_URL_PARAM_LENGTH) return null;
  const url = new URL(baseUrl);
  url.search = '';
  url.hash = `${URL_PARAM}=${param}`;
  return url.href;
}

// URLに付いている、まだ適用していない設定を読む（無い・適用済み・壊れている場合は null）。
// 戻り値は { param, settings }。大きすぎて受け付けない場合は settings が null。
// URLを開いただけで設定が書き換わらないよう、ここでは保存しない。
// 利用者に確認したうえで acceptUrlSettings() に渡す。
export async function readUrlSettings(hash) {
  const param = new URLSearchParams(hash.replace(/^#/, '')).get(URL_PARAM);
  if (!param || param === readJson(APPLIED_URL_KEY)) return null;
  if (param.length > MAX_URL_PARAM_LENGTH) return { param, settings: null };
  try {
    return { param, settings: await decodeSettingsParam(param) };
  } catch (error) {
    console.warn('URLの設定を読み込めませんでした', error);
    return null;
  }
}

// readUrlSettings() で読んだ設定を保存する。
// 同じURLの設定は一度しか適用しない。ホームURLに設定したまま端末側で設定を編集しても、
// 次に開いたときにURLの内容で巻き戻らないようにするため。
export function acceptUrlSettings({ param, settings }) {
  saveSettings(settings);
  writeJson(APPLIED_URL_KEY, param);
}
