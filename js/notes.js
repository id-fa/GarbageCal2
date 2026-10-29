// ノートの本文。設定（sgcal.settings）とは別のキーに保存し、エクスポート／インポートも別のファイルで行う。
// 見た目（罫線・配色・書体・文字の大きさ）は設定側（settings.notes）が持つ。

import { INK_IMAGE_LINE } from './markdown.js';
import { readJson, writeJson } from './storage.js';

const STORAGE_KEY = 'sgcal.notes';
const MAX_PAGES = 30;
const MAX_TITLE_LENGTH = 40;
// 1ページの本文の上限（文字数。手書き画像の行は別枠）。localStorage 全体の上限（5MB 前後）に余裕を残す
const MAX_TEXT_LENGTH = 100000;
// 手書き画像の行（data: URI を含む）の上限（文字数）。画面いっぱいの PNG でも通常は数百 KB に収まる
export const MAX_INK_LENGTH = 1000000;
export const DEFAULT_PAGE_TITLE = 'メモ';

// 画像らしい行（途中で切れたものや data: 以外の形式も含む）。normalizeText() で手書き画像以外を外す
const IMAGE_LIKE_LINE = /^!\[[^\]\n]*\]\(data:[^\n]*$/gm;
// 手書き画像を残す位置の印。IMAGE_LIKE_LINE に当てはまるので、置き換え後の本文にこの行は他に残らない
const INK_MARK = '![](data:)';
const INK_MARK_LINE = /^!\[\]\(data:\)$/m;

const text = (value, maxLength) => (typeof value === 'string' ? value.slice(0, maxLength) : '');

export function newPage(title = DEFAULT_PAGE_TITLE, body = '') {
  return { title: normalizeTitle(title), text: normalizeText(body) };
}

export function normalizeTitle(value) {
  return text(value, MAX_TITLE_LENGTH).trim() || DEFAULT_PAGE_TITLE;
}

// 改行コードを LF にそろえ、長すぎる本文は切り詰める。
// 手書き画像の行は1ページに1つだけ残し（2つ目以降・大きすぎるもの・形の崩れたものは外す）、
// その行の長さは本文の上限とは別に数える
export function normalizeText(value) {
  const raw = text(value, MAX_TEXT_LENGTH * 2 + MAX_INK_LENGTH).replace(/\r\n?/g, '\n');
  let ink = '';
  const rest = raw.replace(IMAGE_LIKE_LINE, (line) => {
    if (ink || line.length > MAX_INK_LENGTH || !INK_IMAGE_LINE.test(line)) return '';
    ink = line;
    return INK_MARK;
  });
  if (!ink) return rest.slice(0, MAX_TEXT_LENGTH);
  const [before, after] = rest.split(INK_MARK_LINE);
  const head = before.slice(0, MAX_TEXT_LENGTH);
  return head + ink + after.slice(0, MAX_TEXT_LENGTH - head.length);
}

// 本文に含まれる手書き画像の data: URI。無ければ null
export function inkOf(body) {
  return body.match(new RegExp(INK_IMAGE_LINE.source, 'm'))?.[2] ?? null;
}

// 外から来た値（保存データ・インポート）を、必ず1ページ以上あるノートにする
export function normalizeNotes(raw) {
  const pages = (Array.isArray(raw?.pages) ? raw.pages : [])
    .slice(0, MAX_PAGES)
    .map((page) => newPage(page?.title, page?.text));
  if (pages.length === 0) pages.push(newPage());
  const active = Number.isInteger(raw?.active) ? raw.active : 0;
  return {
    version: 1,
    pages,
    active: Math.min(Math.max(active, 0), pages.length - 1),
  };
}

export function canAddPage(notes) {
  return notes.pages.length < MAX_PAGES;
}

export function loadNotes() {
  return normalizeNotes(readJson(STORAGE_KEY));
}

export function saveNotes(notes) {
  return writeJson(STORAGE_KEY, notes);
}

// エクスポート用の JSON。表示中のページ（active）は端末ごとの状態なので含めない
export function serializeNotes(notes) {
  return JSON.stringify({ version: 1, pages: notes.pages }, null, 2);
}

// インポートされた JSON 文字列をノートにする。ノートとして読めなければ例外を投げる。
export function parseNotesJson(json) {
  const raw = JSON.parse(json);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages)) {
    throw new Error('ノートファイルの形式が正しくありません');
  }
  return normalizeNotes(raw);
}

// Markdown ファイルから作るページ。ファイル名（拡張子を除く）をページ名にする
export function pageFromFile(fileName, body) {
  return newPage(fileName.replace(/\.[^.]+$/, ''), body);
}
