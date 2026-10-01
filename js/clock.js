// 現在時刻。端末の内蔵時計は信用せず、サーバーの Date ヘッダーとの差分で補正する。

import { readJson, writeJson } from './storage.js';

const STORAGE_KEY = 'sgcal.clock';
const PROBE_URL = './favicon.ico';
const MAX_ROUND_TRIP_MS = 5000;
// Date ヘッダーは秒未満が切り捨てられるので、平均的な誤差ぶんを足しておく
const DATE_HEADER_BIAS_MS = 500;

// オフラインで起動したときは前回の差分をそのまま使う
const saved = readJson(STORAGE_KEY);
let offsetMs = Number.isFinite(saved?.offsetMs) ? saved.offsetMs : 0;
let syncedAt = Number.isFinite(saved?.syncedAt) ? saved.syncedAt : null;

// 補正済みの現在時刻（エポックミリ秒）
export function now() {
  return Date.now() + offsetMs;
}

export function clockStatus() {
  return { offsetMs, syncedAt };
}

// サーバー時刻との差分を取り直す。取得できたら true。
export async function syncClock() {
  try {
    const sentAt = Date.now();
    // キャッシュ済みレスポンスの古い Date を掴まないよう、毎回違うURLでネットワークに出す
    const res = await fetch(`${PROBE_URL}?_=${sentAt}`, { method: 'HEAD', cache: 'no-store' });
    const receivedAt = Date.now();
    const serverMs = Date.parse(res.headers.get('Date') ?? '');
    if (Number.isNaN(serverMs) || receivedAt - sentAt > MAX_ROUND_TRIP_MS) return false;

    offsetMs = Math.round(serverMs + DATE_HEADER_BIAS_MS - (sentAt + receivedAt) / 2);
    syncedAt = now();
    writeJson(STORAGE_KEY, { offsetMs, syncedAt });
    return true;
  } catch {
    return false;
  }
}
