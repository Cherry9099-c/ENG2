/** 句式标注弹层：选一个句子 → 立刻看机器标注 → 可以存进长难句 */

import * as store from './store.js';
import { openSheet, closeSheet, toast } from './ui.js';
import { escape } from './text.js';
import { analyzeSentence, renderAnalysis } from './parse.js';

/**
 * @param {string} sentence 原句
 * @param {string} source   出处
 * @param {Function} [onSaved]
 */
export function openParseSheet(sentence, source, onSaved) {
  const res = analyzeSentence(sentence);
  const already = store.allSentences().find(
    (s) => String(s.en || '').trim() === String(sentence).trim()
  );

  openSheet(`
    <div class="sheet-title" style="font-size:var(--fs-lg)">句式标注</div>
    <div class="sheet-sub">先自己划一遍主干和从句，再往下对照</div>

    <div class="sheet-quote">${escape(sentence)}</div>

    ${renderAnalysis(res)}

    <textarea id="psTrans" class="reader-input" style="min-height:70px;margin-top:var(--s3)"
      placeholder="我的翻译…（可以留空）"></textarea>

    <div class="sheet-actions">
      <button class="btn primary block" id="psSave" ${already ? 'disabled' : ''}>
        ${already ? '✓ 已在长难句里' : '存入长难句'}
      </button>
      <button class="btn block" data-close>关闭</button>
    </div>
  `);

  const save = document.getElementById('psSave');
  if (save && !already) {
    save.onclick = () => {
      const trans = (document.getElementById('psTrans') || {}).value || '';
      store.addUserSentence({
        en: sentence,
        source: source || '阅读器',
        pending: true,
        cn: trans.trim(),                       // 自己写的翻译
        auto: {
          main: res.main,
          bracket: res.bracket,
          chunks: res.chunks.map((c) => ({ tag: c.tag, text: c.text, note: c.note || '' })),
        },
      });
      closeSheet();
      toast('已存入长难句');
      if (onSaved) onSaved();
    };
  }
}
