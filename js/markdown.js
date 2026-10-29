// ノート本文（Markdown）の読み書き。
// ノート用紙に書く感覚に合わせ、1行を1行として扱う（改行はそのまま改行、空行は空の行として残る）。
// 対応する書き方: # 見出し（#〜####）、- 箇条書き、1. 番号付き、- [ ] チェック、> 引用、--- 区切り線、
// ``` コード、**太字**、*斜体*、~~取り消し~~、`コード`、[表示名](https://…)、素の URL、
// 手書き画像 ![手書き](data:image/png;base64,…)（1行まるごと。画像は data: の PNG/WebP/JPEG だけ）。
// 入れ子の箇条書きは行頭を2文字以上下げる。記号を文字として書きたいときは \ を前に付ける。
//
// 見たまま編集（contenteditable）の DOM から Markdown に戻す domToMarkdown() もここにある。
// 描画は dom.js の h() で組み立て、本文を HTML として解釈することはない。

import { h } from './dom.js';

const HEADING = /^(#{1,4}) +(.*)$/;
// 行頭の空白・記号（- + * または 1.）・空白・本文
const LIST_ITEM = /^( *)([-+*]|\d{1,9}\.) +(.*)$/;
const TASK = /^\[([ xX])\] ?(.*)$/;
const QUOTE = /^> ?(.*)$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^```/;
const LINK = /^\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^\s)]+)\)/;
const URL = /^https?:\/\/[^\s)]+/;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
// 手書き画像の行。外部の URL は読みに行かず、data: に埋め込まれた画像だけを受け付ける
export const INK_IMAGE_LINE = /^!\[([^\]\n]*)\]\((data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/=]+)\)[ \t]*$/;
export const INK_ALT = '手書き';

export function inkImageLine(src) {
  return `![${INK_ALT}](${src})`;
}

// ---- Markdown → ブロック構造 ----

// lines を解釈してブロックの配列にする。offset は lines[0] が本文全体で何行目か（チェックの行番号に使う）
export function parseBlocks(lines, offset = 0) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const code = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i += 1;
      blocks.push({ type: 'code', lines: code });
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    const image = line.match(INK_IMAGE_LINE);
    if (image) {
      blocks.push({ type: 'image', alt: image[1], src: image[2] });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const start = i;
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].match(QUOTE)[1]);
      blocks.push({ type: 'quote', blocks: parseBlocks(inner, offset + start) });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const [list, consumed] = parseList(lines, i, offset);
      blocks.push(list);
      i += consumed;
      continue;
    }
    if (line.trim() === '') {
      blocks.push({ type: 'blank' });
      i += 1;
      continue;
    }
    blocks.push({ type: 'line', inline: parseInline(line) });
    i += 1;
  }
  return blocks;
}

// lines[start] から始まるリストを読む。戻り値は [リストのブロック, 消費した行数]
function parseList(lines, start, offset) {
  const first = lines[start].match(LIST_ITEM);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const item = line.match(LIST_ITEM);
    if (item) {
      const depth = item[1].length;
      if (depth < indent) break;
      if (depth <= indent + 1) {
        // 同じ段の項目。箇条書きと番号付きが切り替わったら別のリストにする
        if (/\d/.test(item[2]) !== ordered) break;
        const task = item[3].match(TASK);
        items.push({
          task: task ? task[1] !== ' ' : null,
          line: offset + i,
          text: task ? task[2] : item[3],
          children: [],
        });
        i += 1;
        continue;
      }
      // 深い段の項目は直前の項目の入れ子にする
      const [nested, consumed] = parseList(lines, i, offset);
      items.at(-1).children.push(nested);
      i += consumed;
      continue;
    }
    // 行頭を下げた普通の行は、直前の項目の続き（項目の中での改行）
    const continuation = line.match(/^( {2,})(\S.*)$/);
    if (continuation && continuation[1].length >= indent + 2) {
      items.at(-1).text += `\n${continuation[2]}`;
      i += 1;
      continue;
    }
    break;
  }
  const list = {
    type: 'list',
    ordered,
    items: items.map((item) => ({ ...item, inline: parseInline(item.text) })),
  };
  return [list, i - start];
}

// ---- Markdown → 行内の構造 ----

// 閉じる記号の位置。中身が空・直前が空白・\ でエスケープされたものは閉じとみなさない
function findClose(text, from, delim) {
  let i = from;
  while (i < text.length) {
    const j = text.indexOf(delim, i);
    if (j === -1) return -1;
    const prev = text[j - 1];
    const escaped = prev === '\\';
    const partOfStrong = delim === '*' && text[j + 1] === '*';
    if (j === from || escaped || /\s/.test(prev) || partOfStrong) {
      i = j + (partOfStrong ? 2 : 1);
      continue;
    }
    return j;
  }
  return -1;
}

export function parseInline(text) {
  const nodes = [];
  let buf = '';
  const flush = () => {
    if (buf) nodes.push({ type: 'text', text: buf });
    buf = '';
  };
  const wrapped = (delim, type, from) => {
    if (/\s/.test(text[from] ?? ' ')) return false;
    const end = findClose(text, from, delim);
    if (end === -1) return false;
    flush();
    nodes.push({ type, children: parseInline(text.slice(from, end)) });
    i = end + delim.length;
    return true;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const rest = text.slice(i);
    if (ch === '\\' && ASCII_PUNCT.test(text[i + 1] ?? '')) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      flush();
      nodes.push({ type: 'br' });
      i += 1;
      continue;
    }
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: 'code', text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith('**') && wrapped('**', 'strong', i + 2)) continue;
    if (ch === '*' && wrapped('*', 'em', i + 1)) continue;
    if (rest.startsWith('~~') && wrapped('~~', 'del', i + 2)) continue;
    if (ch === '[') {
      const link = rest.match(LINK);
      if (link) {
        flush();
        nodes.push({ type: 'link', href: link[2], children: parseInline(link[1]) });
        i += link[0].length;
        continue;
      }
    }
    if (ch === 'h') {
      const url = rest.match(URL);
      if (url) {
        flush();
        nodes.push({ type: 'link', href: url[0], children: [{ type: 'text', text: url[0] }] });
        i += url[0].length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return nodes;
}

// ---- ブロック構造 → DOM ----

function renderInline(nodes) {
  return nodes.map((node) => {
    switch (node.type) {
      case 'br':
        return h('br');
      case 'code':
        return h('code', null, node.text);
      case 'strong':
        return h('strong', null, renderInline(node.children));
      case 'em':
        return h('em', null, renderInline(node.children));
      case 'del':
        return h('s', null, renderInline(node.children));
      case 'link':
        return h(
          'a',
          { href: node.href, target: '_blank', rel: 'noopener noreferrer' },
          renderInline(node.children),
        );
      default:
        return node.text;
    }
  });
}

// 中身が空のブロックも1行ぶんの高さを持つよう <br> を入れる
function withContent(nodes) {
  return nodes.length > 0 ? nodes : [h('br')];
}

function renderItem(item) {
  const checkbox =
    item.task === null
      ? null
      : h('input', {
          type: 'checkbox',
          class: 'task-box',
          checked: item.task,
          'data-line': item.line,
          contenteditable: 'false',
        });
  return h(
    'li',
    { class: item.task === null ? null : 'task' },
    checkbox,
    withContent(renderInline(item.inline)),
    renderBlocks(item.children),
  );
}

// 手書き画像の箱。編集中もブラウザに中身を触らせない（contenteditable=false）
export function renderInk(src, alt = INK_ALT) {
  return h(
    'figure',
    { class: 'note-ink', contenteditable: 'false' },
    h('img', { src, alt, draggable: 'false' }),
  );
}

function renderBlocks(blocks) {
  return blocks.map((block) => {
    switch (block.type) {
      case 'blank':
        return h('p', { class: 'blank' }, h('br'));
      case 'image':
        return renderInk(block.src, block.alt);
      case 'heading':
        return h(`h${block.level}`, null, withContent(renderInline(block.inline)));
      case 'hr':
        return h('hr');
      case 'code':
        return h('pre', null, block.lines.length > 0 ? block.lines.join('\n') : h('br'));
      case 'quote':
        return h('blockquote', null, renderBlocks(block.blocks));
      case 'list':
        return h(block.ordered ? 'ol' : 'ul', null, block.items.map(renderItem));
      default:
        return h('p', null, withContent(renderInline(block.inline)));
    }
  });
}

// Markdown の本文を DOM ノードの配列にする
export function renderMarkdown(text) {
  return renderBlocks(parseBlocks(text.split('\n')));
}

// 指定した行のチェック（- [ ] / - [x]）を反転した本文を返す
export function toggleTask(text, lineIndex) {
  const lines = text.split('\n');
  if (lines[lineIndex] === undefined) return text;
  lines[lineIndex] = lines[lineIndex].replace(
    /^( *(?:[-+*]|\d{1,9}\.) +)\[([ xX])\]/,
    (_, head, mark) => `${head}[${mark === ' ' ? 'x' : ' '}]`,
  );
  return lines.join('\n');
}

// ---- DOM → Markdown（見たまま編集の内容を本文に戻す）----
// renderMarkdown() が作った要素だけでなく、contenteditable でブラウザが作る要素
// （div、b、i、strike、span など）も受け付ける。

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR', 'PRE', 'TABLE', 'SECTION', 'ARTICLE', 'FIGURE',
]);

// 文字として書かれた記号が書式として解釈されないようにする
function escapeText(text) {
  return text.replace(/[\\*`[]/g, '\\$&').replace(/~~/g, '\\~~');
}

// 行頭がブロックの記号に見える行をエスケープする
function escapeLineStart(line) {
  if (/^(?:#{1,4} |>|[-+] |-{3,}\s*$|_{3,}\s*$|```)/.test(line)) return `\\${line}`;
  return line.replace(/^(\d{1,9})\. /, '$1\\. ');
}

// 行内の書式を記号で囲む。前後の空白は囲みの外に出し、改行をまたがないよう行ごとに囲む
function wrap(delim, text) {
  return text
    .split('\n')
    .map((line) => {
      const [, lead, body, trail] = line.match(/^(\s*)(.*?)(\s*)$/s);
      return body ? `${lead}${delim}${body}${delim}${trail}` : line;
    })
    .join('\n');
}

function inlineToText(nodes) {
  return [...nodes].map(inlineNodeToText).join('');
}

function inlineNodeToText(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const inner = () => inlineToText(node.childNodes);
  switch (node.tagName) {
    case 'BR':
      return '\n';
    case 'B':
    case 'STRONG':
      return wrap('**', inner());
    case 'I':
    case 'EM':
      return wrap('*', inner());
    case 'S':
    case 'STRIKE':
    case 'DEL':
      return wrap('~~', inner());
    case 'CODE': {
      const code = node.textContent.replaceAll('`', '');
      return code ? `\`${code}\`` : '';
    }
    case 'A': {
      const href = node.getAttribute('href') ?? '';
      if (!/^https?:\/\//.test(href)) return inner();
      if (node.textContent === href) return href;
      return `[${inner().replaceAll(']', '\\]')}](${href})`;
    }
    case 'INPUT':
    case 'IMG':
    case 'BUTTON':
      return '';
    default:
      // 行内の途中にブロック要素が混ざっていたら前後で行を分ける
      return BLOCK_TAGS.has(node.tagName) ? `\n${inner()}\n` : inner();
  }
}

// 行内ノードの並びを段落として lines に足す
function pushParagraph(nodes, lines, prefix) {
  let text = inlineToText(nodes);
  // 末尾の <br> はブラウザが行の高さを保つために置くものなので、行とは数えない
  if (text.endsWith('\n')) text = text.slice(0, -1);
  for (const line of text.split('\n')) lines.push(prefix + escapeLineStart(line.trimEnd()));
}

// container の子を順に見て、行内ノードの連なりは段落、ブロック要素はそれぞれの書き方で lines に足す
function blocksToLines(container, lines, prefix) {
  let inline = [];
  const flush = () => {
    if (inline.length > 0) pushParagraph(inline, lines, prefix);
    inline = [];
  };
  for (const node of container.childNodes) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
    if (!isBlock) {
      // ブロックの間の空白だけのテキストは整形用なので無視する
      if (inline.length === 0 && node.nodeType === Node.TEXT_NODE && node.textContent.trim() === '') continue;
      inline.push(node);
      continue;
    }
    flush();
    blockToLines(node, lines, prefix);
  }
  flush();
}

function listToLines(list, lines, prefix) {
  const ordered = list.tagName === 'OL';
  let n = 0;
  for (const item of list.children) {
    if (item.tagName !== 'LI') {
      blockToLines(item, lines, prefix);
      continue;
    }
    n += 1;
    const marker = ordered ? `${n}. ` : '- ';
    const checkbox = item.querySelector(':scope > input[type="checkbox"]');
    const task = checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : '';
    const sub = [];
    blocksToLines(item, sub, '');
    if (sub.length === 0) sub.push('');
    const indent = ' '.repeat(marker.length);
    sub.forEach((line, i) => lines.push(prefix + (i === 0 ? marker + task : indent) + line));
  }
}

function blockToLines(el, lines, prefix) {
  const heading = el.tagName.match(/^H([1-6])$/);
  if (heading) {
    const level = Math.min(Number(heading[1]), 4);
    lines.push(`${prefix}${'#'.repeat(level)} ${inlineToText(el.childNodes).replaceAll('\n', ' ').trim()}`);
    return;
  }
  switch (el.tagName) {
    case 'UL':
    case 'OL':
      listToLines(el, lines, prefix);
      return;
    case 'BLOCKQUOTE':
      blocksToLines(el, lines, `${prefix}> `);
      return;
    case 'HR':
      lines.push(`${prefix}---`);
      return;
    case 'PRE':
      lines.push(`${prefix}\`\`\``);
      for (const line of el.textContent.replace(/\n$/, '').split('\n')) lines.push(prefix + line);
      lines.push(`${prefix}\`\`\``);
      return;
    case 'FIGURE': {
      // 手書き画像（renderInk() が作った箱）。それ以外の figure は中身だけ残す
      const src = el.querySelector(':scope > img')?.getAttribute('src') ?? '';
      if (INK_IMAGE_LINE.test(inkImageLine(src))) lines.push(prefix + inkImageLine(src));
      else blocksToLines(el, lines, prefix);
      return;
    }
    default:
      blocksToLines(el, lines, prefix);
  }
}

// contenteditable の中身を Markdown にする
export function domToMarkdown(root) {
  const lines = [];
  blocksToLines(root, lines, '');
  return lines.join('\n');
}
