// 手書きメモ。ノートの編集中に「手書き」で開く描画パッド（createInkPad）と、閲覧中に縮小表示を
// タップしたとき元の大きさで見せるビューア（createInkViewer）。
// 描いたものは data: URI の PNG にして notes-ui.js に渡し、Markdown の本文に ![手書き](data:…) の行として
// 埋め込まれる。縮小表示で潰れても読めるよう、画像は描いたときの大きさ（画面の大きさ × 端末の画素密度）の
// まま保持し、描き直すときもその大きさを引き継ぐ。
// 用紙は配色テーマによらず白で、ペンは黒・赤・青の3色、太さは固定。

import { h } from './dom.js';

export const INK_COLORS = [
  { name: 'black', label: '黒', value: '#1a1a1a' },
  { name: 'red', label: '赤', value: '#d8232a' },
  { name: 'blue', label: '青', value: '#1f4fc4' },
];
const PAPER_COLOR = '#fff';
// ペンの太さ（画面上の px）。縮小表示でも読めるよう太めにしている
const PEN_WIDTH_PX = 8;
// 端末の画素密度を反映する上限。これ以上細かくしても画像が大きくなるだけなので抑える
const MAX_SCALE = 2;
const MAX_PIXELS = 2560 * 1600;

// 画面上の大きさ（rect）に object-fit: contain で収めたキャンバスの、表示倍率と余白
function mapping(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height) || 1;
  return {
    scale,
    left: rect.left + (rect.width - canvas.width * scale) / 2,
    top: rect.top + (rect.height - canvas.height * scale) / 2,
  };
}

function paintStroke(context, stroke, from = 0) {
  const { points } = stroke;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  if (points.length === 1) {
    // 点を打っただけのときも、ペン先の丸が残るようにする
    context.beginPath();
    context.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  context.moveTo(points[Math.max(from - 1, 0)].x, points[Math.max(from - 1, 0)].y);
  for (let i = Math.max(from, 1); i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
  context.stroke();
}

// 描画パッド。open(既存の画像の data: URI か null) は、「決定」で { action: 'save', src }、
// 全部消して「決定」か「削除」で { action: 'remove' }、変更なし・キャンセルで null に解決する。
// maxLength は保存できる data: URI の長さの上限（超えたら決定できない）
export function createInkPad({ container, maxLength }) {
  const canvas = h('canvas', { class: 'ink-canvas', 'aria-label': '手書きの用紙' });
  const context = canvas.getContext('2d');
  const notice = h('p', { class: 'notice', role: 'status' });
  const colorButtons = INK_COLORS.map((item) =>
    h('button', {
      type: 'button',
      class: 'ink-color',
      style: `--ink: ${item.value}`,
      'aria-label': item.label,
      title: item.label,
      onclick: () => selectColor(item),
    }),
  );
  const deleteButton = h('button', { type: 'button', class: 'button subtle', onclick: () => settle({ action: 'remove' }) }, '削除');
  const dialog = h(
    'dialog',
    { class: 'ink-pad', 'aria-label': '手書き' },
    h(
      'div',
      { class: 'ink-tools' },
      h('div', { class: 'ink-colors', role: 'group', 'aria-label': 'ペンの色' }, colorButtons),
      h('button', { type: 'button', class: 'button', onclick: () => undo() }, '一つ戻す'),
      h('button', { type: 'button', class: 'button', onclick: () => clear() }, '全部消す'),
      notice,
      h('span', { class: 'spacer' }),
      deleteButton,
      h('button', { type: 'button', class: 'button subtle', onclick: () => settle(null) }, 'キャンセル'),
      h('button', { type: 'button', class: 'button primary', onclick: () => finish() }, '決定'),
    ),
    h('div', { class: 'ink-canvas-box' }, canvas),
  );
  container.append(dialog);

  let color = INK_COLORS[0];
  // 開いたときの画像（描き直すとき）。新規なら null
  let base = null;
  // 開いてからの操作。{ type: 'stroke', color, width, points } か { type: 'clear' }
  let actions = [];
  // 描いている最中のストローク { id, map, stroke }
  let active = null;
  let resolve = null;

  function selectColor(item) {
    color = item;
    colorButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(INK_COLORS[i] === item)));
  }

  function repaint() {
    context.fillStyle = PAPER_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (base) context.drawImage(base, 0, 0);
    for (const action of actions) {
      if (action.type === 'clear') {
        context.fillStyle = PAPER_COLOR;
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        paintStroke(context, action);
      }
    }
  }

  function undo() {
    actions.pop();
    repaint();
  }

  function clear() {
    actions.push({ type: 'clear' });
    repaint();
  }

  // 何か描かれているか（開いたときの画像も含む）
  function hasContent() {
    const lastClear = actions.findLastIndex((action) => action.type === 'clear');
    if (actions.slice(lastClear + 1).length > 0) return true;
    return lastClear === -1 && base !== null;
  }

  function finish() {
    if (actions.length === 0) {
      settle(null);
      return;
    }
    if (!hasContent()) {
      settle({ action: 'remove' });
      return;
    }
    const src = canvas.toDataURL('image/png');
    if (src.length > maxLength) {
      notice.textContent = '書き込みが多すぎて保存できません。少し消してください。';
      return;
    }
    settle({ action: 'save', src });
  }

  function settle(result) {
    if (!resolve) return;
    const done = resolve;
    resolve = null;
    active = null;
    actions = [];
    base = null;
    // 画像のメモリを手放す
    canvas.width = 1;
    canvas.height = 1;
    if (dialog.open) dialog.close();
    done(result);
  }

  // Esc などで閉じられたときもキャンセルとして扱う
  dialog.addEventListener('close', () => settle(null));

  // ---- 描く ----

  function addPoint(e) {
    const { map, stroke } = active;
    const point = { x: (e.clientX - map.left) / map.scale, y: (e.clientY - map.top) / map.scale };
    stroke.points.push(point);
    paintStroke(context, stroke, stroke.points.length - 1);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (active || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const map = mapping(canvas);
    const stroke = { type: 'stroke', color: color.value, width: PEN_WIDTH_PX / map.scale, points: [] };
    active = { id: e.pointerId, map, stroke };
    actions.push(stroke);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // 取れなくても描ける（用紙の外に出たときに線が途切れるだけ）
    }
    addPoint(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    // 画面の更新より細かく届いた位置も拾って、線をなめらかにする
    const coalesced = e.getCoalescedEvents?.();
    for (const event of coalesced?.length ? coalesced : [e]) addPoint(event);
  });
  const endStroke = (e) => {
    if (active && e.pointerId === active.id) active = null;
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  // 新規のときのキャンバスの大きさ。画面上の大きさに端末の画素密度（上限つき）を掛ける
  function sizeForNew() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const scale = Math.min(window.devicePixelRatio || 1, MAX_SCALE, Math.sqrt(MAX_PIXELS / (width * height)));
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }

  async function loadBase(src) {
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
      return img;
    } catch {
      return null;
    }
  }

  return {
    async open(existing) {
      if (resolve) return null;
      const result = new Promise((done) => {
        resolve = done;
      });
      notice.textContent = '';
      deleteButton.hidden = !existing;
      selectColor(color);
      dialog.showModal();
      base = existing ? await loadBase(existing) : null;
      // 読み込みを待つ間に閉じられていたら何もしない
      if (!resolve) return result;
      if (existing && !base) notice.textContent = '元の画像を読み込めませんでした。';
      const size = base ? { width: base.naturalWidth, height: base.naturalHeight } : sizeForNew();
      canvas.width = size.width;
      canvas.height = size.height;
      // 読み込みを待つ間に触れた分は大きさが合わないので捨てる
      actions = [];
      repaint();
      return result;
    },
    close() {
      settle(null);
    },
  };
}

// 元の大きさで見せるビューア。画面に収まる最大の大きさで表示し、どこをタップしても閉じる
export function createInkViewer({ container }) {
  const img = h('img', { class: 'ink-view', alt: '手書き' });
  const dialog = h(
    'dialog',
    { class: 'ink-viewer', 'aria-label': '手書きの拡大表示', onclick: () => dialog.close() },
    img,
    h('button', { type: 'button', class: 'button ink-viewer-close' }, '閉じる'),
  );
  dialog.addEventListener('close', () => img.removeAttribute('src'));
  container.append(dialog);
  return {
    show(src) {
      img.setAttribute('src', src);
      if (!dialog.open) dialog.showModal();
    },
    close() {
      if (dialog.open) dialog.close();
    },
  };
}
