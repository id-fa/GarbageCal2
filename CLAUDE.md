# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

タブレットに常時表示しておくカレンダー付き時計（高齢の家族向け）。リポジトリ直下（`index.html` `style.css` `sw.js` `js/`）が本体で、ビルド・依存パッケージ・サーバー側処理のない静的ファイル（素の ES Modules）。HTTPS で配信する前提（Service Worker のため）。

- 直下 … アプリ本体（GitHub Pages でそのまま配信される）
- `migration/` … 旧版の設定を再現したインポート用 JSON（ローカルの `.git/info/exclude` で除外）
- `original/` … 旧版（PHP）。参照用なので変更しない
- `docs/` … README 用のスクリーンショット

設置方法や利用者向けの説明は `README.md` にある。

## コマンド

ビルド・lint・テストフレームワークはない。

```bash
# ローカルで動かす（localhost は Service Worker が有効。Date ヘッダーも返るので時刻同期も試せる）
python -m http.server 8765

# 構文チェック
for f in js/*.js sw.js; do node --check "$f"; done
```

ロジック系モジュール（`dates.js` `holidays.js` `garbage.js` `settings.js` `notes.js`、`markdown.js` の `parseBlocks()` / `parseInline()` / `toggleTask()`）は DOM に依存せず、`storage.js` が localStorage の無い環境を吸収するので、Node からそのまま `import` して確認できる。

```bash
node --input-type=module -e "
const { computeHolidays } = await import('file:///D:/_CODE/GarbageCal2/js/holidays.js');
console.log(computeHolidays(2026));
"
```

時刻に依存する表示（深夜・正午前後・月末・年末年始）をブラウザで確認するときは、ページのスクリプトより先に `Date.now` を差し替え、あわせて HEAD リクエストを失敗させる。HEAD を通すとサーバー時刻で補正されて本当の時刻に戻る（それ自体が時刻補正の確認になる）。

## 設計上の決まりごと

### 時刻と日付

- 現在時刻は必ず `clock.js` の `now()`（サーバーの `Date` ヘッダーとの差で補正済み）を使う。`Date.now()` や `new Date()` を直接使わない。
- 日付は `{ y, m, d }`（月は1始まり）のプレーンオブジェクトで持ち、計算は `dates.js` の関数で行う。**日本時間固定**で、端末のタイムゾーンに依存する `getHours()` などのローカル系メソッドは使わない（`jstParts()` が UTC 系メソッドで分解する）。
- 描画は補正後時刻の分境界に合わせた `setTimeout` で回している（`main.js` の `scheduleTick`）。時刻補正が変わったら `refresh()` で描き直しとタイマーの張り直しを両方行う。

### 設定

- 設定は localStorage（`sgcal.settings`）にだけ保存する。地域や家庭ごとの値（ごみの曜日、メモなど）をコードに書かない。
- 保存データ・インポート・設定付きURL のどこから来た値も、必ず `settings.js` の `normalizeSettings()` を通す。型・範囲・件数の検証はここ1か所。
- 設定項目を追加するときに触る場所: `defaultSettings()` → `normalizeSettings()` → `settings-ui.js` の入力欄 → 値を使う側。`migration/*.json` も `normalizeSettings()` を通して書き直しておく。古い保存データに項目が無くても既定値で埋まるので、移行処理は不要。
- 設定ダイアログは下書き（`draft`）を編集し、「保存」で初めて反映する。入力欄は `draft` を直接書き換えるヘルパー（`textField` など）で作る。
- 写真だけは設定に含めない。端末内のファイルは場所を覚えても後から開けないので、選ばれた画像を縮小して中身ごと IndexedDB に保存する（`photo.js`）。設定側（`photo`）に持つのは表示のオン／オフとカレンダーの位置だけで、写真そのものはエクスポートや設定付きURLに乗らない。ダイアログでは設定と同じく下書き（`draftPhoto`）として持ち、「保存」で初めて書き込む。
- 設定付きURL（`#cfg=…`）は同じ内容を一度しか適用しない（`sgcal.appliedUrlConfig` に記録）。ホームURLに設定したまま端末側で編集しても巻き戻らないようにするため。
- 設定付きURLは開いただけでは適用しない。`readUrlSettings()` で読み、確認ダイアログで「取り込む」が選ばれてから `acceptUrlSettings()` で保存する（リンクを踏ませるだけで設定やメモを差し替えられないようにするため）。`cfg` は `MAX_URL_PARAM_LENGTH` 文字までで、作る側・受け取る側の両方で弾く。超える設定は JSON のエクスポート／インポートで渡す。

### 祝日

`holidays.js` の `holidayName()` は年ごとに 取得済みデータ（localStorage）→ 同梱 `syukujitsu.csv` → 祝日法による計算 の順で参照する。取得元（Holidays JP API）は前年〜翌年しか返さず、内閣府の CSV は CORS 非対応でブラウザから取得できない。`computeHolidays()` を変更したら、同梱 CSV の 2022 年以降と突き合わせて一致を確認する。

### 描画

- DOM は `dom.js` の `h()` / `svg()` で組み立てる。設定由来の文字列（メモ、ごみの文言）は URL 経由でも入ってくるので、`innerHTML` を使わない。メモのリンク化は `view.js` の `linkify()` だけが行う。
- `view.js` は状態を持たず、渡された日付と設定から描くだけ。状態（設定・表示中の月・タイマー）は `main.js` にある。
- 文字サイズは各パネルの大きさに連動させている（`.pane` がサイズコンテナで、`min(○cqw, ○cqh)` で指定）。縦向き・横向きの両方、および 6 週ある月で確認する。
- 写真を表示するときは `.calendar-pane` に `.has-photo` が付き、カレンダーの箱（`.calendar-box`）が小さくなって下の隅に重なる。このとき箱がサイズコンテナになるので、中の `cqw` / `cqh` は箱の大きさが基準になる。写真あり・なしの両方で確認する。
- 色は `style.css` 冒頭の CSS 変数（`--bg` `--text` など）だけで決め、個別の箇所に色を直接書かない。配色テーマは `<html>` の `data-theme` 属性で変数を差し替える（`view.js` の `applyTheme()`）。`settings.js` の `THEMES` と対応し、設定ダイアログの見本にも同じ属性を使う。テーマを足すときは `THEMES`・`style.css` の変数一式と `color-scheme`・`settings-ui.js` の `THEME_LABELS` を揃える。
- カレンダー上の「今日」の見せ方は `.today-<スタイル名>` クラス。`settings.js` の `TODAY_STYLES` と対応し、設定ダイアログの見本にも同じクラスを使う。

### ノート

- 本文は `notes.js` が localStorage の `sgcal.notes` に持ち、設定（`sgcal.settings`）には含めない。エクスポート／インポートも別ファイル（ノート全体の JSON、1ページの Markdown）。外から来た値は `normalizeNotes()` を通す（ページ数・文字数の上限、必ず1ページ以上）。
- 見た目（切り替える範囲 `area`・罫線 `rule`・配色 `theme`・書体 `font`・文字の大きさ `size`）だけが設定の `notes` にある。`settings.js` の `NOTE_*` 定数、`style.css` の `[data-note-*]`、`settings-ui.js` のラベルを揃える。ノートのパネル（`#note-pane`）にこれらの `data-note-*` 属性を付けて切り替え、設定ダイアログの見本（`.note-sample.paper`）も同じ属性で描く。
- 表示中は `.app` に `data-notes="<area>"` が付き、置き換えられるパネルが消える。編集中は設定にかかわらず `full`（`main.js` の `applyNotesArea()`）。状態（開いているか・放置タイマー）は `main.js`、ページ・編集中かどうかは `notes-ui.js` が持つ。`render()`（毎分）はノートに触らない。
- Markdown は `markdown.js`。1行＝1行（空行は空の行、改行はそのまま改行）で、一般的な Markdown のように段落をまとめない。描画は `renderMarkdown()`（`h()` で組み立て、`innerHTML` は使わない）。見たまま編集は contenteditable で、`domToMarkdown()` が DOM（ブラウザが作る `div` `b` `i` 等も含む）を本文に戻す。記号を文字として書いた箇所は `\` でエスケープして往復させる。閲覧中のチェックは `toggleTask()` で該当行だけ書き換える。
- 編集中は入力のたびに（少し遅らせて）保存する。見たまま編集では DOM を描き直さず、ページ切り替え・モード切り替え・完了のときだけ `commit()` で本文に戻す。
- 手書き画像は本文の `![手書き](data:image/png;base64,…)` 行（`markdown.js` の `INK_IMAGE_LINE`。1行まるごと、`data:` の画像だけ）。描くパッドと拡大表示は `ink.js` で、本文への差し込み・置き換え・削除は `notes-ui.js`（見たまま編集は `figure.note-ink` を DOM 操作、ソース編集は文字列操作）。1ページ1画像と行の長さの上限（`MAX_INK_LENGTH`）は `notes.js` の `normalizeText()` が守る（本文の上限とは別枠）。画像は描いたときの画素数のまま保持し、描き直すときも同じ大きさで開く。用紙は常に白、ペン色は `ink.js` の `INK_COLORS`。

### Service Worker

`sw.js` は同一オリジンの GET を network-first（4 秒でキャッシュにフォールバック）で扱うので、オンラインなら常に最新ファイルが使われる。同一オリジンの取得は `cache: 'no-cache'` でブラウザの HTTP キャッシュに毎回再検証させるので、`?v=` の付かない `import` 先のモジュールや `syukujitsu.csv` も SW 有効後は最新になる（`?v=` は SW が効く前の初回読み込みのため）。GET 以外（時刻同期の HEAD）には手を出さない。**ファイルを追加・削除したら `ASSETS` を更新し、`CACHE` の番号を上げる。** `index.html` の `style.css` / `main.js` の `?v=` も合わせて更新する。
