/**
 * 文本处理：分词、断句、挖空、高亮
 *
 * 这个模块不依赖浏览器 API，所以 tools/check.js 也能直接 import 来复用同一套匹配逻辑。
 */

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function escape(str) { return escapeHtml(str); }

/** 把一段文字切成 词 / 非词 的片段，保留原始下标 */
export function tokenize(text) {
  const tokens = [];
  let last = 0;
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: 'gap', text: text.slice(last, m.index) });
    tokens.push({ type: 'word', text: m[0], start: m.index, end: m.index + m[0].length });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'gap', text: text.slice(last) });
  return tokens;
}

export function words(text) {
  return text.match(WORD_RE) || [];
}

/** 按句末标点断句 */
export function splitSentences(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [clean];
  return parts.map((s) => s.trim()).filter((s) => s.length > 1);
}

/** 按换行切段 */
export function splitParagraphs(text) {
  return String(text)
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 为一个单词生成「原形 + 常见变形」的正则片段 */
function inflect(word) {
  const w = String(word).toLowerCase();
  if (w.length <= 3) return escRe(w);

  const forms = new Set([w]);
  if (/[^aeiou]y$/.test(w)) {
    const stem = w.slice(0, -1);
    forms.add(stem + 'ies');
    forms.add(stem + 'ied');
    forms.add(w + 's');
    forms.add(w + 'ing');
  } else if (/e$/.test(w)) {
    forms.add(w + 's');
    forms.add(w + 'd');
    forms.add(w + 'ed');
    forms.add(w.slice(0, -1) + 'ing');
  } else {
    forms.add(w + 's');
    forms.add(w + 'ed');
    forms.add(w + 'd');
    forms.add(w + 'ing');
  }
  return '(?:' + [...forms].sort((a, b) => b.length - a.length).map(escRe).join('|') + ')';
}

/**
 * 生成能匹配该词条的正则源码。
 *
 * 规则变形能覆盖 undermine→undermined、account for→accounts for 这类情况；
 * 但不规则变化（give→given、fall→fell）覆盖不了，这时在卡片里写
 * context.match: ["give rise to", "given rise to", ...] 显式指定。
 */
export function termPattern(term, extraForms) {
  const extra = extraForms ? [].concat(extraForms).filter(Boolean) : null;
  if (extra && extra.length) {
    return '(?:' + extra
      .map((f) => String(f).trim().toLowerCase().split(/\s+/).map(escRe).join('\\s+'))
      .join('|') + ')';
  }
  return String(term).trim().toLowerCase().split(/\s+/).map(inflect).join('\\s+');
}

export function termRegex(term, extraForms) {
  return new RegExp(`\\b(?:${termPattern(term, extraForms)})\\b`, 'gi');
}

/** 句子里是否真的出现了这个（含变形的）词条 */
export function matchesTerm(sentence, term, extraForms) {
  if (!sentence || !term) return false;
  return termRegex(term, extraForms).test(String(sentence));
}

/** 找出句子里实际出现的那个表面形式，例如 undermine → "undermined" */
export function surfaceForm(sentence, term, extraForms) {
  const m = String(sentence).match(termRegex(term, extraForms));
  return m ? m[0] : null;
}

/** 把词条在句子中高亮（用于答案面） */
export function highlight(sentence, term, extraForms) {
  if (!sentence) return '';
  if (!matchesTerm(sentence, term, extraForms)) return escapeHtml(sentence);
  return escapeHtml(sentence)
    .replace(termRegex(term, extraForms), '<span class="hit">$&</span>');
}

/* 说明：这里原本还有 sentenceOf / translationOf / sourceOf / matchFormsOf 四个
   取卡片字段的小函数，是复习页用的。复习页去掉后没人调了，已删除。
   要用的时候直接写 card.context?.sentence 就行。 */
