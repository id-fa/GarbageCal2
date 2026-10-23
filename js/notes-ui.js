// ノート画面。タブでページを切り替え、「編集」を押すと見たまま（contenteditable）か
// ソース（textarea）で本文を書き換えられる。本文は notes.js を通じて localStorage に保存し、
// 見た目（罫線・配色・書体・文字の大きさ）は設定から applyDesign() で受け取る。
// 閲覧中はチェック項目のオン／オフだけができる。

import { downloadText, h } from './dom.js';
import { domToMarkdown, renderMarkdown, toggleTask } from './markdown.js';
import {
  DEFAULT_PAGE_TITLE,
  canAddPage,
  loadNotes,
  newPage,
  normalizeText,
  normalizeTitle,
  pageFromFile,
  parseNotesJson,
  saveNotes,
  serializeNotes,
} from './notes.js';
import { NOTE_SIZES } from './settings.js';

const EXPORT_FILE_NAME = 'sgcalendar-notes.json';
// 編集中は入力が止まってからこの時間で保存する
const SAVE_DELAY_MS = 500;
// タブをこれだけ動かしたら並べ替えとみなす（それより小さければタップ）
const DRAG_THRESHOLD_PX = 8;
const SIZE_LABELS = { small: '小', medium: '中', large: '大', xlarge: '特大' };
const BLOCK_LABELS = { P: '本文', H1: '見出し1', H2: '見出し2', H3: '見出し3' };
const BLOCK_CYCLE = ['P', 'H1', 'H2', 'H3'];

function taskBox(checked) {
  return h('input', { type: 'checkbox', class: 'task-box', checked, contenteditable: 'false' });
}

function within(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function setupNotePane({ pane, onSizeChange, onClose, onEditingChange }) {
  let notes = loadNotes();
  let editing = false;
  // 編集のしかた: visual（見たまま）か source（Markdown のソース）
  let editor = 'visual';
  // 見たまま編集の DOM に、まだ本文へ戻していない変更があるか
  let dirty = false;
  let saveTimer = null;
  let size = NOTE_SIZES[0];
  // タブの並べ替え直後に click が届いても、ページ切り替えとして扱わない
  let suppressClick = false;

  const page = () => notes.pages[notes.active];

  // ---- 要素 ----

  const tabList = h('div', { class: 'note-tab-list', role: 'tablist' });
  const addButton = h(
    'button',
    { type: 'button', class: 'button subtle note-add', hidden: true, onclick: () => addPage() },
    '＋ ページ',
  );
  const sizeButton = h('button', { type: 'button', class: 'button subtle', onclick: () => cycleSize() });
  const editButton = h(
    'button',
    { type: 'button', class: 'button', onclick: () => (editing ? finishEditing() : startEditing()) },
    '編集',
  );
  const backButton = h(
    'button',
    { type: 'button', class: 'button subtle note-back', onclick: () => onClose() },
    'カレンダー',
  );

  const body = h('div', { class: 'note-body paper', contenteditable: 'false' });
  const source = h('textarea', {
    class: 'note-source paper',
    hidden: true,
    spellcheck: 'false',
    'aria-label': 'Markdown のソース',
  });
  const paper = h('div', { class: 'note-paper' }, body, source);

  // 編集ツール。ボタンを押しても編集中のカーソル位置（選択範囲）が失われないよう mousedown を止める
  const tool = (label, run, attrs = {}) =>
    h(
      'button',
      { type: 'button', class: 'button tool', onmousedown: (e) => e.preventDefault(), onclick: run, ...attrs },
      label,
    );
  const modeButtons = ['visual', 'source'].map((mode) =>
    h(
      'button',
      { type: 'button', class: 'button mode', 'data-mode': mode, onclick: () => switchEditor(mode) },
      mode === 'visual' ? '見たまま' : 'ソース',
    ),
  );
  const blockButton = tool(BLOCK_LABELS.P, () => cycleBlock(), { 'data-block': 'P' });
  const formatButtons = [
    blockButton,
    tool('太字', () => exec('bold'), { 'data-command': 'bold' }),
    tool('斜体', () => exec('italic'), { 'data-command': 'italic' }),
    tool('取り消し線', () => exec('strikeThrough'), { 'data-command': 'strikeThrough' }),
    tool('・箇条書き', () => exec('insertUnorderedList'), { 'data-command': 'insertUnorderedList' }),
    tool('1. 番号', () => exec('insertOrderedList'), { 'data-command': 'insertOrderedList' }),
    tool('☑ チェック', () => toggleTaskItem()),
    tool('リンク', () => insertLink()),
    tool('区切り線', () => exec('insertHorizontalRule')),
    tool('元に戻す', () => exec('undo')),
  ];
  const visualTools = h('div', { class: 'note-format-tools' }, formatButtons);
  const toolbar = h(
    'div',
    { class: 'note-toolbar', hidden: true },
    h('div', { class: 'note-mode', role: 'group', 'aria-label': '編集のしかた' }, modeButtons),
    visualTools,
  );

  const titleInput = h('input', {
    type: 'text',
    class: 'note-title',
    maxlength: 40,
    'aria-label': 'ページ名',
    oninput: () => {
      const tab = tabList.children[notes.active];
      if (tab) tab.textContent = titleInput.value.trim() || DEFAULT_PAGE_TITLE;
      scheduleCommit();
    },
  });
  const notice = h('p', { class: 'notice', role: 'status' });
  const markdownInput = fileInput('.md,.txt,text/markdown,text/plain', importMarkdown);
  const jsonInput = fileInput('application/json,.json', importNotes);
  const pageTools = h(
    'div',
    { class: 'note-page-tools', hidden: true },
    h('label', { class: 'field' }, h('span', null, 'ページ名'), titleInput),
    h(
      'div',
      { class: 'inline' },
      h('button', { type: 'button', class: 'button subtle', onclick: () => deletePage() }, 'このページを削除'),
      h('button', { type: 'button', class: 'button', onclick: () => markdownInput.click() }, 'Markdownをインポート'),
      h('button', { type: 'button', class: 'button', onclick: () => exportMarkdown() }, 'Markdownをエクスポート'),
      h('button', { type: 'button', class: 'button', onclick: () => jsonInput.click() }, 'ノート全体をインポート'),
      h('button', { type: 'button', class: 'button', onclick: () => exportNotes() }, 'ノート全体をエクスポート'),
      markdownInput,
      jsonInput,
    ),
    notice,
  );

  pane.replaceChildren(
    h(
      'header',
      { class: 'note-header' },
      h('div', { class: 'note-tabs' }, tabList, addButton),
      h('div', { class: 'note-actions' }, sizeButton, editButton, backButton),
    ),
    toolbar,
    pageTools,
    paper,
  );

  function fileInput(accept, handle) {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', async () => {
      const [file] = input.files;
      // 同じファイルをもう一度選べるようにする
      input.value = '';
      if (file) await handle(file);
    });
    return input;
  }

  // ---- 保存 ----

  function save() {
    if (!saveNotes(notes)) notice.textContent = 'ノートを保存できませんでした（ブラウザの保存領域が使えません）。';
  }

  // 編集中の内容を本文に戻して保存する
  function commit() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!editing) return;
    const current = page();
    if (editor === 'visual' && dirty) {
      current.text = normalizeText(domToMarkdown(body));
      dirty = false;
    } else if (editor === 'source') {
      current.text = normalizeText(source.value);
    }
    current.title = normalizeTitle(titleInput.value);
    save();
  }

  function scheduleCommit() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(commit, SAVE_DELAY_MS);
  }

  function markDirty() {
    dirty = true;
    scheduleCommit();
  }

  // ---- 描画 ----

  function renderTabs() {
    tabList.replaceChildren(
      ...notes.pages.map((item, i) => {
        const tab = h(
          'button',
          {
            type: 'button',
            class: 'note-tab',
            role: 'tab',
            'aria-selected': String(i === notes.active),
            'data-index': String(i),
            onclick: () => {
              if (!suppressClick) selectPage(i);
            },
          },
          item.title,
        );
        enableDrag(tab);
        return tab;
      }),
    );
    addButton.hidden = !editing || !canAddPage(notes);
  }

  function renderBody() {
    const current = page();
    const visual = !editing || editor === 'visual';
    body.hidden = !visual;
    source.hidden = visual;
    if (visual) {
      body.replaceChildren(...renderMarkdown(current.text));
      body.setAttribute('contenteditable', editing ? 'true' : 'false');
      dirty = false;
    } else {
      source.value = current.text;
      source.setSelectionRange(0, 0);
    }
    titleInput.value = current.title;
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === editor));
    }
    visualTools.hidden = !editing || editor !== 'visual';
    paper.scrollTop = 0;
    updateToolState();
  }

  function renderAll() {
    renderTabs();
    renderBody();
  }

  function selectPage(index) {
    if (index === notes.active) return;
    commit();
    notes.active = index;
    save();
    renderAll();
  }

  // ---- 編集の開始・終了 ----

  function startEditing() {
    editing = true;
    pane.classList.add('editing');
    toolbar.hidden = false;
    pageTools.hidden = false;
    editButton.textContent = '完了';
    notice.textContent = '';
    onEditingChange(true);
    renderAll();
    (editor === 'visual' ? body : source).focus();
  }

  function finishEditing() {
    commit();
    editing = false;
    pane.classList.remove('editing');
    toolbar.hidden = true;
    pageTools.hidden = true;
    editButton.textContent = '編集';
    onEditingChange(false);
    renderAll();
  }

  function switchEditor(mode) {
    if (mode === editor) return;
    commit();
    editor = mode;
    renderBody();
    (editor === 'visual' ? body : source).focus();
  }

  // ---- 見たまま編集のツール ----

  function selectionElement() {
    const node = document.getSelection()?.anchorNode;
    if (!node || !body.contains(node)) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function closestInBody(el, selector) {
    const found = el?.closest(selector);
    return found && body.contains(found) && found !== body ? found : null;
  }

  function exec(command, value = null) {
    if (!selectionElement()) body.focus();
    document.execCommand(command, false, value);
    markDirty();
    updateToolState();
  }

  // ボタンの表示を、カーソル位置の書式に合わせる
  function updateToolState() {
    if (!editing || editor !== 'visual') return;
    const el = selectionElement();
    if (!el) return;
    const heading = closestInBody(el, 'h1, h2, h3');
    const block = heading ? heading.tagName : 'P';
    blockButton.dataset.block = block;
    blockButton.textContent = BLOCK_LABELS[block];
    for (const button of formatButtons) {
      const { command } = button.dataset;
      if (command) button.setAttribute('aria-pressed', String(document.queryCommandState(command)));
    }
  }

  // 本文 → 見出し1 → 見出し2 → 見出し3 → 本文 と切り替える
  function cycleBlock() {
    const index = BLOCK_CYCLE.indexOf(blockButton.dataset.block);
    const next = BLOCK_CYCLE[(index + 1) % BLOCK_CYCLE.length];
    exec('formatBlock', `<${next.toLowerCase()}>`);
  }

  // カーソルのある項目にチェックボックスを付ける／外す。箇条書きでなければ箇条書きにしてから付ける
  function toggleTaskItem() {
    let item = closestInBody(selectionElement(), 'li');
    if (!item) {
      exec('insertUnorderedList');
      item = closestInBody(selectionElement(), 'li');
      if (!item) return;
    }
    const box = item.querySelector(':scope > input[type="checkbox"]');
    if (box) {
      box.remove();
      item.classList.remove('task');
    } else {
      item.prepend(taskBox(false));
      item.classList.add('task');
    }
    markDirty();
  }

  function insertLink() {
    const input = prompt('リンク先のURL', 'https://');
    const trimmed = input?.trim();
    if (!trimmed || trimmed === 'https://') return;
    const url = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!selectionElement()) body.focus();
    const selection = document.getSelection();
    if (selection.isCollapsed) {
      // 選択していなければ URL をそのまま書き込み、それを選び直してリンクにする
      document.execCommand('insertText', false, url);
      const range = selection.getRangeAt(0);
      if (range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset >= url.length) {
        range.setStart(range.endContainer, range.endOffset - url.length);
      }
    }
    document.execCommand('createLink', false, url);
    selection.collapseToEnd();
    markDirty();
  }

  // ---- ページの操作 ----

  function addPage() {
    if (!canAddPage(notes)) return;
    commit();
    notes.pages.splice(notes.active + 1, 0, newPage());
    notes.active += 1;
    save();
    renderAll();
    titleInput.focus();
    titleInput.select();
  }

  function deletePage() {
    commit();
    if (!confirm(`「${page().title}」を削除します。元に戻せません。よろしいですか？`)) return;
    notes.pages.splice(notes.active, 1);
    if (notes.pages.length === 0) notes.pages.push(newPage());
    notes.active = Math.min(notes.active, notes.pages.length - 1);
    save();
    renderAll();
  }

  async function importMarkdown(file) {
    if (!canAddPage(notes)) {
      notice.textContent = 'これ以上ページを追加できません。';
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch {
      notice.textContent = 'ファイルを読み込めませんでした。';
      return;
    }
    commit();
    notes.pages.splice(notes.active + 1, 0, pageFromFile(file.name, text));
    notes.active += 1;
    save();
    renderAll();
    notice.textContent = `「${page().title}」をページとして追加しました。`;
  }

  function exportMarkdown() {
    commit();
    downloadText(`${page().title}.md`, page().text, 'text/markdown');
  }

  async function importNotes(file) {
    let parsed;
    try {
      parsed = parseNotesJson(await file.text());
    } catch {
      notice.textContent = 'ノートファイルを読み込めませんでした。';
      return;
    }
    const count = notes.pages.length;
    if (!confirm(`ノート全体を置き換えます。いまのノート（${count}ページ）は消えて元に戻せません。よろしいですか？`)) {
      return;
    }
    notes = parsed;
    dirty = false;
    save();
    renderAll();
    notice.textContent = `${notes.pages.length}ページを読み込みました。`;
  }

  function exportNotes() {
    commit();
    downloadText(EXPORT_FILE_NAME, serializeNotes(notes), 'application/json');
  }

  function cycleSize() {
    onSizeChange(NOTE_SIZES[(NOTE_SIZES.indexOf(size) + 1) % NOTE_SIZES.length]);
  }

  // ---- タブの並べ替え（編集中だけ。ポインタで引きずる）----

  function enableDrag(tab) {
    tab.addEventListener('pointerdown', (e) => {
      if (!editing || !e.isPrimary) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const onMove = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
          dragging = true;
          tab.classList.add('dragging');
        }
        const target = [...tabList.children].find(
          (other) => other !== tab && within(other.getBoundingClientRect(), ev.clientX, ev.clientY),
        );
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const before = ev.clientX < rect.left + rect.width / 2;
        tabList.insertBefore(tab, before ? target : target.nextSibling);
      };
      const onEnd = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onEnd);
        document.removeEventListener('pointercancel', onEnd);
        if (!dragging) return;
        tab.classList.remove('dragging');
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 0);
        // タブの並びをページの並びに反映する
        const active = page();
        notes.pages = [...tabList.children].map((el) => notes.pages[Number(el.dataset.index)]);
        notes.active = notes.pages.indexOf(active);
        save();
        renderTabs();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onEnd);
      document.addEventListener('pointercancel', onEnd);
    });
  }

  // ---- 本文のイベント ----

  body.addEventListener('input', () => {
    if (!editing) return;
    // Enter でチェック項目を増やしたとき、ブラウザは li を複製するがチェックボックスは付けないので補う
    for (const item of body.querySelectorAll('li.task')) {
      if (item.querySelector(':scope > input[type="checkbox"]')) continue;
      const box = taskBox(false);
      item.prepend(box);
      const selection = document.getSelection();
      if (selection && item.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.setStartAfter(box);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    markDirty();
  });

  // 空のチェック項目で Enter を押したら、チェックリストを抜ける。
  // チェックボックスがあるとブラウザは項目を空とみなさず、リストから出られなくなるため
  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || !editing) return;
    const item = closestInBody(selectionElement(), 'li');
    const box = item?.querySelector(':scope > input[type="checkbox"]');
    if (!box || item.textContent.trim() !== '') return;
    e.preventDefault();
    box.remove();
    item.classList.remove('task');
    // 空の項目での Enter はブラウザがリストを抜ける操作として扱う
    document.execCommand('insertParagraph');
    markDirty();
  });

  // 閲覧中のチェックは本文の該当行を書き換えて保存する。編集中は DOM の状態を本文に戻すときに拾う
  body.addEventListener('change', (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox') return;
    if (editing) {
      markDirty();
      return;
    }
    page().text = toggleTask(page().text, Number(box.dataset.line));
    save();
  });

  source.addEventListener('input', scheduleCommit);
  document.addEventListener('selectionchange', updateToolState);
  // 画面が隠れる・閉じられるときに編集中の内容を取りこぼさない
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') commit();
  });
  window.addEventListener('pagehide', commit);

  // Enter で段落（p）を作る。既定の div だと見たままとソースの対応が崩れやすい
  document.execCommand('defaultParagraphSeparator', false, 'p');

  return {
    show() {
      pane.hidden = false;
      renderAll();
    },
    hide() {
      if (editing) finishEditing();
      pane.hidden = true;
    },
    isEditing: () => editing,
    // 設定の見た目（settings.notes）を反映する
    applyDesign(design) {
      size = design.size;
      pane.dataset.noteTheme = design.theme;
      pane.dataset.noteRule = design.rule;
      pane.dataset.noteFont = design.font;
      pane.dataset.noteSize = design.size;
      sizeButton.textContent = `文字 ${SIZE_LABELS[design.size]}`;
    },
  };
}
