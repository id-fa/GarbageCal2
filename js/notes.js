// ノートの本文。設定（sgcal.settings）とは別のキーに保存し、エクスポート／インポートも別のファイルで行う。
// 見た目（罫線・配色・書体・文字の大きさ）は設定側（settings.notes）が持つ。

import { readJson, writeJson } from './storage.js';

const STORAGE_KEY = 'sgcal.notes';
const MAX_PAGES = 30;
const MAX_TITLE_LENGTH = 40;
// 1ページの本文の上限（文字数）。localStorage 全体の上限（5MB 前後）に余裕を残す
const MAX_TEXT_LENGTH = 100000;
export const DEFAULT_PAGE_TITLE = 'メモ';

const text = (value, maxLength) => (typeof value === 'string' ? value.slice(0, maxLength) : '');

export function newPage(title = DEFAULT_PAGE_TITLE, body = '') {
  return { title: normalizeTitle(title), text: normalizeText(body) };
}

export function normalizeTitle(value) {
  return text(value, MAX_TITLE_LENGTH).trim() || DEFAULT_PAGE_TITLE;
}

// 改行コードを LF にそろえ、長すぎる本文は切り詰める
export function normalizeText(value) {
  return text(value, MAX_TEXT_LENGTH + 2).replace(/\r\n?/g, '\n').slice(0, MAX_TEXT_LENGTH);
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
