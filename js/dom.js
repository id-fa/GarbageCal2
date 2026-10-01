// 要素を組み立てる小さなヘルパー。文言はすべてテキストノードとして入るので、
// 設定由来の文字列（メモなど）がHTMLとして解釈されることはない。

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(el, attrs, children) {
  el.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  // select の value は option が揃ってからでないと効かないので、属性は子要素の後に設定する
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else if (name === 'value' || name === 'checked') el[name] = value;
    else el.setAttribute(name, value === true ? '' : value);
  }
  return el;
}

export function h(tag, attrs, ...children) {
  return build(document.createElement(tag), attrs, children);
}

export function svg(tag, attrs, ...children) {
  return build(document.createElementNS(SVG_NS, tag), attrs, children);
}
