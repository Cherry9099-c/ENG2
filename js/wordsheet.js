/** 点词弹层：阅读器和长难句共用 */

import * as dict from './dict.js';
import * as store from './store.js';
import { openSheet, closeSheet, toast } from './ui.js';
import { escape, highlight } from './text.js';

/**
 * @param {string} word 被点的单词
 * @param {{sentence?:string, source?:string}} ctx 上下文
 * @param {Function} [onAdded] 加入生词本后的回调
 */
export function openWordSheet(word, ctx = {}, onAdded) {
  const entry = dict.lookup(word);
  const existing = store.findCardByTerm(entry ? entry.base : word);
  const sentence = ctx.sentence || '';

  openSheet(`
    <div class="sheet-title">${escape(entry ? entry.base : word)}</div>
    ${entry && entry.phon ? `<div class="sheet-sub">/${escape(entry.phon)}/</div>` : ''}

    <div class="word-mean" style="margin-top:var(--s4)">
      ${entry
        ? `${entry.pos ? `<span class="pos">${escape(entry.pos)}</span>` : ''}${escape(entry.cn)}`
        : '<span class="mute">内置词库里没有这个词，可以自己填一个简短释义。</span>'}
    </div>

    ${sentence ? `<div class="sheet-quote">${highlight(sentence, word)}</div>` : ''}

    ${!entry ? `
      <textarea id="manualCn" class="reader-input" style="min-height:70px;margin-top:var(--s3)"
        placeholder="中文释义（可留空）"></textarea>` : ''}

    <div class="sheet-actions">
      ${existing
        ? '<button class="btn block" disabled>✓ 已在生词本里</button>'
        : '<button class="btn primary block" id="wsAdd">加入生词本</button>'}
    </div>
  `);

  const addBtn = document.getElementById('wsAdd');
  if (addBtn) {
    addBtn.onclick = () => {
      const manual = document.getElementById('manualCn');
      const cn = entry ? entry.cn : (manual ? manual.value.trim() : '');
      store.addUserCard({
        type: word.includes(' ') ? 'phrase' : 'word',
        term: entry ? entry.base : word,
        phon: entry ? entry.phon : '',
        pos: entry ? entry.pos : '',
        cn: cn || '（待补充释义）',
        context: sentence ? { sentence, source: ctx.source || '阅读器' } : undefined,
        source: ctx.source || '阅读器',
        tags: ['生词本'],
      });
      store.markWord(word, true);
      toast('已加入生词本');
      closeSheet();
      if (onAdded) onAdded();
    };
  }
}
