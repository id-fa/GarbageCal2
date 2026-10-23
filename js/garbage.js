// ごみ収集の判定。設定（settings.garbage）と日付から、その日の表示文言を決める。
// ごみ情報とは別の行に出す曜日ごとの表示（settings.secondary）もここで判定する。

import { dateKey, nthOfMonth, weekdayOf } from './dates.js';

// その日が休み期間（closures）に入っていれば、その期間を返す
export function findClosure({ closures }, date) {
  const key = dateKey(date);
  const monthDay = key.slice(5);
  return (
    closures.find(({ from, to, yearly }) => {
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

// その日のごみ情報 { text: 表示文言, collected: 収集がある日か, large: 大きい文字で表示するか,
//   extraLarge: 大きい文字をさらに大きくするか（large のときだけ true になる） }。
// ごみ情報を使わない設定なら null。
export function garbageInfo(garbage, date) {
  if (!garbage.enabled) return null;

  const closure = findClosure(garbage, date);
  if (closure) {
    const text = closure.label ? `ごみ収集はお休み（${closure.label}）` : 'ごみ収集はお休み';
    return { text, collected: false, large: false, extraLarge: false };
  }

  const weekday = weekdayOf(date);
  const nth = nthOfMonth(date);
  const weekly = garbage.weekly[weekday];
  const rules = garbage.rules.filter((rule) => rule.weekday === weekday);
  const matched = rules.filter((rule) => rule.weeks.includes(nth)).map((rule) => rule.text);

  if (!weekly && matched.length === 0) {
    return {
      text: garbage.noneText,
      collected: false,
      large: garbage.noneTextLarge,
      extraLarge: garbage.noneTextLarge && garbage.extraLarge,
    };
  }

  // 該当しない週の文言（「古紙回収なし」など）は、他に出せるごみがある日にだけ添える
  const unmatched = rules
    .filter((rule) => !rule.weeks.includes(nth) && rule.offText)
    .map((rule) => rule.offText);
  return {
    text: [weekly, ...matched, ...unmatched].filter(Boolean).join('・'),
    collected: true,
    // 曜日ごとの文言を含む日だけ大きくする（第n曜日のルールだけの日は通常の大きさ）
    large: garbage.weeklyLarge && Boolean(weekly),
    extraLarge: garbage.weeklyLarge && garbage.extraLarge && Boolean(weekly),
  };
}

// ごみ情報とは別の行に出す、その日の曜日ごとの表示 { text, large, extraLarge }。
// 使わない設定・文言が未設定の曜日・表示しない期間のときは null。
export function secondaryInfo(secondary, date) {
  if (!secondary.enabled) return null;
  if (findClosure(secondary, date)) return null;
  const text = secondary.weekly[weekdayOf(date)];
  if (!text) return null;
  return { text, large: secondary.large, extraLarge: secondary.large && secondary.extraLarge };
}
