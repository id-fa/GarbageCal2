// 設定ダイアログ。開いている間は下書き（draft）を編集し、「保存」で初めて反映する。

import { clockStatus } from './clock.js';
import { WEEKDAYS, jstParts } from './dates.js';
import { h } from './dom.js';
import { holidayStatus } from './holidays.js';
import {
  TODAY_STYLES,
  buildSettingsUrl,
  defaultSettings,
  normalizeSettings,
  parseSettingsJson,
  serializeSettings,
} from './settings.js';

const EXPORT_FILE_NAME = 'sgcalendar-settings.json';
const TODAY_STYLE_LABELS = {
  fill: '塗りつぶし',
  outline: '枠線',
  underline: '下線',
  circle: '丸で囲む',
  tint: '薄い背景',
};

function formatTime(epochMs) {
  if (epochMs === null) return '未取得';
  const { y, m, d, hour, minute } = jstParts(epochMs);
  return `${y}/${m}/${d} ${hour}:${String(minute).padStart(2, '0')}`;
}

// ---- 下書きの値と結び付いた入力欄 ----

function textField(target, key, attrs = {}) {
  return h('input', {
    type: 'text',
    value: target[key],
    ...attrs,
    oninput: (e) => {
      target[key] = e.target.value;
    },
  });
}

function dateField(target, key, label) {
  return h('input', {
    type: 'date',
    value: target[key],
    'aria-label': label,
    oninput: (e) => {
      target[key] = e.target.value;
    },
  });
}

function hourField(target, key, max) {
  return h('input', {
    type: 'number',
    min: 0,
    max,
    step: 1,
    inputmode: 'numeric',
    value: target[key],
    oninput: (e) => {
      target[key] = e.target.valueAsNumber;
    },
  });
}

function checkField(target, key, label) {
  return h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: target[key],
      onchange: (e) => {
        target[key] = e.target.checked;
      },
    }),
    label,
  );
}

// 配列に値が入っているかどうかをチェックボックスで切り替える
function memberField(values, value, label) {
  return h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked: values.includes(value),
      onchange: (e) => {
        const index = values.indexOf(value);
        if (e.target.checked && index === -1) values.push(value);
        if (!e.target.checked && index !== -1) values.splice(index, 1);
      },
    }),
    label,
  );
}

function weekdaySelect(target, key) {
  return h(
    'select',
    {
      value: String(target[key]),
      'aria-label': '曜日',
      onchange: (e) => {
        target[key] = Number(e.target.value);
      },
    },
    WEEKDAYS.map((name, i) => h('option', { value: String(i) }, `${name}曜`)),
  );
}

// 行の追加・削除ができるリスト
function listEditor(items, { renderRow, createItem, addLabel }) {
  const el = h('div', { class: 'list-editor' });
  const redraw = () => {
    el.replaceChildren(
      ...items.map((item, i) =>
        h(
          'div',
          { class: 'list-row' },
          h('div', { class: 'list-row-fields' }, renderRow(item)),
          h(
            'button',
            {
              type: 'button',
              class: 'button subtle',
              onclick: () => {
                items.splice(i, 1);
                redraw();
              },
            },
            '削除',
          ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => {
            items.push(createItem());
            redraw();
          },
        },
        addLabel,
      ),
    );
  };
  redraw();
  return el;
}

// 今日の日付の目立たせ方を、見本つきの選択肢から選ぶ
function todayStyleField(display) {
  return h(
    'div',
    { class: 'today-choices' },
    TODAY_STYLES.map((style) =>
      h(
        'label',
        { class: 'today-choice' },
        h(
          'span',
          { class: `today-sample today-${style}`, 'aria-hidden': 'true' },
          h('span', { class: 'num' }, '1'),
        ),
        h(
          'span',
          { class: 'check' },
          h('input', {
            type: 'radio',
            name: 'today-style',
            checked: display.todayStyle === style,
            onchange: () => {
              display.todayStyle = style;
            },
          }),
          TODAY_STYLE_LABELS[style],
        ),
      ),
    ),
  );
}

function labeled(label, field) {
  return h('label', { class: 'field' }, h('span', null, label), field);
}

function section(title, ...children) {
  return h('section', { class: 'settings-section' }, h('h3', null, title), children);
}

function group(title, hint, ...children) {
  return h(
    'div',
    { class: 'settings-group' },
    h('h4', null, title),
    hint && h('p', { class: 'hint' }, hint),
    children,
  );
}

export function setupSettingsDialog({ dialog, getSettings, onSave, onSyncClock, onRefreshHolidays }) {
  const body = dialog.querySelector('.settings-body');
  let draft = null;

  function garbageSection() {
    const { garbage } = draft;
    return section(
      'ごみ収集',
      checkField(garbage, 'enabled', 'ごみ情報を表示する'),
      group(
        '曜日ごとの表示',
        '表示したい文言をそのまま入力します（例: 通常ごみの日）。',
        h(
          'div',
          { class: 'weekday-fields' },
          WEEKDAYS.map((name, i) =>
            labeled(`${name}曜`, textField(garbage.weekly, i)),
          ),
          labeled('空欄の曜日', textField(garbage, 'noneText')),
        ),
        checkField(garbage, 'noneTextLarge', '空欄の曜日の文言を大きい文字で表示する'),
      ),
      group(
        '第n曜日だけの収集（資源ごみなど）',
        '選んだ週には「該当する週」の文言を、それ以外の週には「それ以外の週」の文言（空欄可）を表示します。',
        listEditor(garbage.rules, {
          addLabel: 'ルールを追加',
          createItem: () => ({ weekday: 6, weeks: [], text: '', offText: '' }),
          renderRow: (rule) => [
            h(
              'div',
              { class: 'inline' },
              weekdaySelect(rule, 'weekday'),
              [1, 2, 3, 4, 5].map((n) => memberField(rule.weeks, n, `第${n}`)),
            ),
            labeled('該当する週', textField(rule, 'text', { placeholder: '例: 古紙回収あり' })),
            labeled('それ以外の週', textField(rule, 'offText', { placeholder: '例: 古紙回収なし' })),
          ],
        }),
      ),
      group(
        '収集がお休みの期間',
        '年末年始など。「毎年」にすると年は無視して月日だけで判定します。',
        listEditor(garbage.closures, {
          addLabel: '期間を追加',
          createItem: () => ({ from: '', to: '', yearly: true, label: '' }),
          renderRow: (closure) => [
            h(
              'div',
              { class: 'inline' },
              dateField(closure, 'from', '開始日'),
              '〜',
              dateField(closure, 'to', '終了日'),
              checkField(closure, 'yearly', '毎年'),
            ),
            labeled('名称', textField(closure, 'label', { placeholder: '例: 年末年始' })),
          ],
        }),
      ),
    );
  }

  function memoSection() {
    return section(
      'メモ',
      h(
        'p',
        { class: 'hint' },
        '期限を入れるとその日まで表示します。[表示名](https://…) と書くとリンクになります。',
      ),
      listEditor(draft.memos, {
        addLabel: 'メモを追加',
        createItem: () => ({ text: '', until: '' }),
        renderRow: (memo) => [
          textField(memo, 'text', { placeholder: 'メモの内容' }),
          labeled('表示期限', dateField(memo, 'until', '表示期限')),
        ],
      }),
    );
  }

  function displaySection() {
    const { display } = draft;
    return section(
      '表示',
      group(
        '「第n○曜日」と表示する曜日',
        null,
        h(
          'div',
          { class: 'inline' },
          WEEKDAYS.map((name, i) => memberField(display.nthWeekdays, i, name)),
        ),
      ),
      group('カレンダー上の今日の日付', null, todayStyleField(display)),
      group(
        '年の換算',
        null,
        h(
          'div',
          { class: 'inline' },
          checkField(display, 'showHeisei', '平成'),
          checkField(display, 'showShowa', '昭和'),
        ),
      ),
      group(
        '時間帯による表示',
        null,
        h(
          'label',
          { class: 'field' },
          hourField(display, 'midnightHour', 12),
          h('span', null, '時までは、日付が変わっていても「明日（…今日）」と表現する（0で無効）'),
        ),
        h(
          'label',
          { class: 'field' },
          hourField(display, 'tomorrowFromHour', 24),
          h('span', null, '時から明日の情報を表示する（0で常に表示）'),
        ),
        h(
          'label',
          { class: 'field' },
          hourField(display, 'garbageTodayUntilHour', 24),
          h('span', null, '時まで今日のごみ情報を表示する（24で常に表示）'),
        ),
      ),
    );
  }

  function transferSection(message) {
    const notice = h('p', { class: 'notice', role: 'status' }, message);
    const urlOutput = h('textarea', { class: 'url-output', readonly: true, rows: 4, hidden: true });
    const copyButton = h(
      'button',
      {
        type: 'button',
        class: 'button',
        hidden: true,
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(urlOutput.value);
            notice.textContent = 'URLをコピーしました。';
          } catch {
            urlOutput.select();
            notice.textContent = 'URLを選択しました。コピーしてください。';
          }
        },
      },
      'URLをコピー',
    );
    const fileInput = h('input', {
      type: 'file',
      accept: 'application/json,.json',
      hidden: true,
      onchange: async () => {
        const [file] = fileInput.files;
        if (!file) return;
        try {
          draft = parseSettingsJson(await file.text());
          render('設定を読み込みました。「保存」を押すと反映されます。');
        } catch {
          notice.textContent = '設定ファイルを読み込めませんでした。';
        }
      },
    });

    return section(
      '設定の保存・移行',
      h(
        'p',
        { class: 'hint' },
        '設定はこのブラウザの中にだけ保存されます。他の端末へはファイルか設定付きURLで渡せます。',
      ),
      h(
        'div',
        { class: 'inline' },
        h(
          'button',
          {
            type: 'button',
            class: 'button',
            onclick: () => {
              const blob = new Blob([serializeSettings(normalizeSettings(draft))], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              h('a', { href: url, download: EXPORT_FILE_NAME }).click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            },
          },
          'エクスポート',
        ),
        h('button', { type: 'button', class: 'button', onclick: () => fileInput.click() }, 'インポート'),
        h(
          'button',
          {
            type: 'button',
            class: 'button',
            onclick: async () => {
              const base = location.origin + location.pathname;
              urlOutput.value = await buildSettingsUrl(normalizeSettings(draft), base);
              urlOutput.hidden = false;
              copyButton.hidden = false;
              notice.textContent =
                'このURLをタブレットのブラウザのホームに設定すると、この設定で表示されます。';
            },
          },
          '設定付きURLを作成',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'button subtle',
            onclick: () => {
              draft = defaultSettings();
              render('初期値に戻しました。「保存」を押すと反映されます。');
            },
          },
          '初期値に戻す',
        ),
        fileInput,
      ),
      notice,
      urlOutput,
      copyButton,
    );
  }

  function statusSection() {
    const el = h('section', { class: 'settings-section' });
    const redraw = () => {
      const holidays = holidayStatus();
      const clock = clockStatus();
      const holidayRange =
        holidays.years.length > 0
          ? `（${holidays.years[0]}〜${holidays.years.at(-1)}年・${holidays.count}件）`
          : '';
      const offsetSeconds = (clock.offsetMs / 1000).toFixed(1);
      const offline = !('serviceWorker' in navigator)
        ? '利用できません（HTTPSでの配信が必要です）'
        : navigator.serviceWorker.controller
          ? '有効'
          : '準備中（次に開いたときから有効）';

      const action = (label, run) =>
        h(
          'button',
          {
            type: 'button',
            class: 'button',
            onclick: async (e) => {
              e.target.disabled = true;
              const ok = await run();
              redraw();
              el.append(h('p', { class: 'notice', role: 'status' }, ok ? '更新しました。' : '取得できませんでした。'));
            },
          },
          label,
        );

      el.replaceChildren(
        h('h3', null, '動作状況'),
        h(
          'dl',
          { class: 'status' },
          h('dt', null, '祝日データ'),
          h('dd', null, `最終取得: ${formatTime(holidays.fetchedAt)}${holidayRange} `, action('今すぐ更新', onRefreshHolidays)),
          h('dt', null, '時刻'),
          h(
            'dd',
            null,
            `端末の時計との差: ${clock.offsetMs >= 0 ? '+' : ''}${offsetSeconds}秒（最終同期: ${formatTime(clock.syncedAt)}） `,
            action('再同期', onSyncClock),
          ),
          h('dt', null, 'オフライン動作'),
          h('dd', null, offline),
        ),
      );
    };
    redraw();
    return el;
  }

  function render(message = '') {
    body.replaceChildren(
      garbageSection(),
      memoSection(),
      displaySection(),
      transferSection(message),
      statusSection(),
    );
  }

  dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-action="save"]').addEventListener('click', () => {
    onSave(normalizeSettings(draft));
    dialog.close();
  });

  return {
    open() {
      draft = structuredClone(getSettings());
      render();
      dialog.showModal();
      body.scrollTop = 0;
    },
  };
}
