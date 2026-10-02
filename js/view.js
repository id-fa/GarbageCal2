// 画面の描画。渡された日付・設定から DOM を組み立てるだけで、状態は持たない。

import { WEEKDAYS, addDays, dateKey, daysInMonth, nthOfMonth, weekdayOf } from './dates.js';
import { h, svg } from './dom.js';
import { garbageInfo } from './garbage.js';
import { holidayName } from './holidays.js';

function dayColorClass(date, holiday) {
  const weekday = weekdayOf(date);
  if (weekday === 0 || holiday) return 'sun';
  return weekday === 6 ? 'sat' : '';
}

// ---- 配色テーマ ----

export function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // ブラウザのツールバーの色も背景に合わせる。auto のときは index.html に書いてある色（ライト用・ダーク用）に戻す
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.dataset.default ??= meta.content;
    meta.content = theme === 'auto' ? meta.dataset.default : bg;
  }
}

// ---- カレンダー ----

export function renderCalendar(el, month, today, todayStyle) {
  const first = { y: month.y, m: month.m, d: 1 };
  const leading = weekdayOf(first);
  const cellCount = Math.ceil((leading + daysInMonth(month.y, month.m)) / 7) * 7;
  const todayKey = dateKey(today);

  const head = WEEKDAYS.map((name, i) =>
    h('div', { class: `weekday ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}` }, name),
  );
  const cells = Array.from({ length: cellCount }, (_, i) => {
    const date = addDays(first, i - leading);
    if (date.m !== month.m) return h('div', { class: 'day outside' }, h('span', { class: 'num' }, date.d));

    const holiday = holidayName(date);
    const todayClass = dateKey(date) === todayKey ? `today today-${todayStyle}` : '';
    const classes = ['day', dayColorClass(date, holiday), todayClass];
    return h(
      'div',
      { class: classes.filter(Boolean).join(' ') },
      h('span', { class: 'num' }, date.d),
      holiday && h('span', { class: 'holiday-name' }, holiday),
    );
  });

  el.style.setProperty('--weeks', cellCount / 7);
  el.replaceChildren(...head, ...cells);
}

// 「2026年は 令和 8年 / 平成 38年 / 昭和 101年」
export function eraText(year, display) {
  const eras = [
    ['令和', year - 2018, true],
    ['平成', year - 1988, display.showHeisei],
    ['昭和', year - 1925, display.showShowa],
  ];
  const parts = eras.filter(([, n, shown]) => shown && n >= 1).map(([name, n]) => `${name} ${n}年`);
  return parts.length > 0 ? `${year}年は ${parts.join(' / ')}` : '';
}

// ---- 今日・明日の情報 ----

function garbageBadge(info) {
  if (!info) return null;
  const classes = ['garbage', !info.collected && 'none', info.large && 'large'];
  return h('p', { class: classes.filter(Boolean).join(' ') }, info.text);
}

function weekdayLabel(date, display) {
  const weekday = weekdayOf(date);
  const nth = display.nthWeekdays.includes(weekday) ? `第${nthOfMonth(date)}` : '';
  return `${nth}${WEEKDAYS[weekday]}曜日`;
}

export function renderInfo(el, today, hour, settings) {
  const { display, garbage } = settings;
  const tomorrow = addDays(today, 1);
  // 就寝前は日付が変わっていても「今日」の感覚のままなので、深夜は表現を変える
  const isLateNight = hour < display.midnightHour;

  const todayHoliday = holidayName(today);
  const todayGarbage = hour < display.garbageTodayUntilHour ? garbageInfo(garbage, today) : null;
  const blocks = [
    h(
      'div',
      { class: 'info-today' },
      h('p', { class: 'info-lead' }, isLateNight ? '明日（午前零時を回っているので今日）は' : '今日は'),
      h(
        'p',
        { class: `info-date ${dayColorClass(today, todayHoliday)}` },
        h('span', { class: 'info-md' }, `${today.m}月${today.d}日`),
        ' ',
        h('span', { class: 'info-weekday' }, weekdayLabel(today, display)),
      ),
      todayHoliday && h('p', { class: 'info-holiday' }, todayHoliday),
      garbageBadge(todayGarbage),
    ),
  ];

  if (!isLateNight && hour >= display.tomorrowFromHour) {
    const tomorrowHoliday = holidayName(tomorrow);
    blocks.push(
      h(
        'div',
        { class: 'info-tomorrow' },
        h(
          'p',
          { class: 'info-tomorrow-date' },
          h('span', { class: 'info-lead' }, '明日は '),
          h(
            'span',
            { class: `info-weekday ${dayColorClass(tomorrow, tomorrowHoliday)}` },
            weekdayLabel(tomorrow, display),
          ),
          tomorrowHoliday && h('span', { class: 'info-holiday' }, `・${tomorrowHoliday}`),
        ),
        garbageBadge(garbageInfo(garbage, tomorrow)),
      ),
    );
  }

  el.replaceChildren(...blocks);
}

// ---- メモ ----

const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s]+/g;

// 「[表示名](https://…)」と素のURLだけをリンクにし、それ以外は文字のまま出す
function linkify(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    nodes.push(text.slice(last, match.index));
    const href = match[2] ?? match[0];
    nodes.push(h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, match[1] ?? match[0]));
    last = match.index + match[0].length;
  }
  nodes.push(text.slice(last));
  return nodes;
}

export function renderMemos(el, memos, today) {
  const todayKey = dateKey(today);
  const active = memos.filter((memo) => !memo.until || todayKey <= memo.until);
  el.hidden = active.length === 0;
  el.replaceChildren(...active.map((memo) => h('p', { class: 'memo' }, linkify(memo.text))));
}

// ---- 時計 ----

export function digitalText(hour, minute) {
  return `${hour < 12 ? '午前' : '午後'} ${hour % 12}時 ${minute}分`;
}

// アナログ時計の文字盤を作り、針を動かす関数を返す
export function createAnalogClock(el) {
  const ticks = Array.from({ length: 60 }, (_, i) =>
    svg('line', {
      class: i % 5 === 0 ? 'tick major' : 'tick',
      x1: 0,
      y1: i % 5 === 0 ? -85 : -89,
      x2: 0,
      y2: -94,
      transform: `rotate(${i * 6})`,
    }),
  );
  const numerals = Array.from({ length: 12 }, (_, i) => {
    const angle = ((i + 1) * 30 * Math.PI) / 180;
    return svg(
      'text',
      { class: 'numeral', x: 68 * Math.sin(angle), y: -68 * Math.cos(angle) },
      String(i + 1),
    );
  });
  const hourHand = svg('line', { class: 'hand hour', x1: 0, y1: 12, x2: 0, y2: -46 });
  const minuteHand = svg('line', { class: 'hand minute', x1: 0, y1: 16, x2: 0, y2: -78 });

  el.replaceChildren(
    svg('circle', { class: 'face', r: 98 }),
    ...ticks,
    hourHand,
    minuteHand,
    // 数字は針より上に描く（針が重なっても読めるように）
    ...numerals,
    svg('circle', { class: 'pin', r: 5 }),
  );

  return (hour, minute) => {
    hourHand.setAttribute('transform', `rotate(${(hour % 12) * 30 + minute * 0.5})`);
    minuteHand.setAttribute('transform', `rotate(${minute * 6})`);
  };
}
