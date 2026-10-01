// ごみ収集の判定。設定（settings.garbage）と日付から、その日の表示文言を決める。

import { dateKey, nthOfMonth, weekdayOf } from './dates.js';

// その日が収集休み期間に入っていれば、その期間を返す
export function findClosure(garbage, date) {
  const key = dateKey(date);
  const monthDay = key.slice(5);
  return (
    garbage.closures.find(({ from, to, yearly }) => {
      if (!yearly) return from <= key && key <= to;
      // 毎年繰り返す期間は月日だけで比べる（年末年始のように年をまたぐ指定もある）
      const start = from.slice(5);
      const end = to.slice(5);
      return start <= end
        ? start <= monthDay && monthDay <= end
        : monthDay >= start || monthDay <= end;
    }) ?? null
  );
}

// その日のごみ情報 { text: 表示文言, collected: 収集がある日か, large: 大きい文字で表示するか }。
// ごみ情報を使わない設定なら null。
export function garbageInfo(garbage, date) {
  if (!garbage.enabled) return null;

  const closure = findClosure(garbage, date);
  if (closure) {
    const text = closure.label ? `ごみ収集はお休み（${closure.label}）` : 'ごみ収集はお休み';
    return { text, collected: false, large: false };
  }

  const weekday = weekdayOf(date);
  const nth = nthOfMonth(date);
  const weekly = garbage.weekly[weekday];
  const rules = garbage.rules.filter((rule) => rule.weekday === weekday);
  const matched = rules.filter((rule) => rule.weeks.includes(nth)).map((rule) => rule.text);

  if (!weekly && matched.length === 0) {
    return { text: garbage.noneText, collected: false, large: garbage.noneTextLarge };
  }

  // 該当しない週の文言（「古紙回収なし」など）は、他に出せるごみがある日にだけ添える
  const unmatched = rules
    .filter((rule) => !rule.weeks.includes(nth) && rule.offText)
    .map((rule) => rule.offText);
  return {
    text: [weekly, ...matched, ...unmatched].filter(Boolean).join('・'),
    collected: true,
    large: false,
  };
}
