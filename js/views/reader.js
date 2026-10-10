/** 阅读器：真题原文点词查义 / 选句看句式；也可以粘贴自己的文章 */

import * as store from '../store.js';
import { openSheet, closeSheet, toast, openMenu } from '../ui.js';
import { escape, tokenize, splitSentences, splitParagraphs } from '../text.js';
import { openWordSheet } from '../wordsheet.js';
import { openParseSheet } from '../parsesheet.js';

let article = null;       // { title, source, text, paperLabel?, pasted? }
let mode = 'lookup';      // lookup | select
let pane = 'article';     // article | paste
let sentIndex = [];
let loadedOnce = false;
let appliedArg = null;    // 已应用的路由参数（卷子/文章）
let paperIndex = null;
let articlesMissing = false;   // 探测到「这个版本没收录真题原文」（分享版）

async function loadPaperIndex() {
  if (paperIndex) return paperIndex.wordlists || [];
  try {
    const r = await fetch('data/wordlists/index.json', { cache: 'no-cache' });
    paperIndex = await r.json();
  } catch (e) {
    paperIndex = { wordlists: [] };
  }
  return paperIndex.wordlists || [];
}

/**
 * 载入某一篇真题原文。
 * source 用来看归属（句式页按它筛选），title 只用来显示：
 * 两者混在一起的话，标题会变成一长串，而存下来的句子又会因为少了个
 * 卷子前缀而在「只看某卷」里消失。
 */
async function loadArticle(pKey, secId) {
  let title = `${pKey} ${secId}`;
  let source = title;
  let paperLabel = '';
  try {
    const papers = await loadPaperIndex();
    const paper = papers.find((p) => p.key === pKey);
    const sm = (paper?.sections || []).find((s) => s.id === secId);
    if (paper && sm) {
      source = sm.source || `${paper.label} · ${sm.label}`;
      title = sm.label + (sm.topic ? ` · ${sm.topic}` : '');
      paperLabel = paper.label;
    }
  } catch (e) { /* 标题拿不到就用默认的 */ }

  try {
    const res = await fetch(`data/articles/${pKey}/${secId}.txt`, { cache: 'no-cache' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    article = {
      title,
      source,
      paperLabel,
      text: await res.text(),
      // 完形填空的 20 个答案词在原始 PDF 里就没有（只标了编号），
      // 所以原文读起来是断的。这不是网站出错，得先说清楚。
      isCloze: secId === 'use-of-english',
    };
    pane = 'article';
    mode = 'lookup';
    return true;
  } catch (e) {
    console.warn('[reader] 文章载入失败', e);
    // 公开的「分享版」整个摘掉了 data/articles/，这时要给一句人话，
    // 否则用户会以为是网站坏了
    if (e && e.status === 404) {
      articlesMissing = true;
      toast('这个版本没有收录真题原文，可以用「我自己的文章」贴一篇来读');
    } else {
      toast('这篇原文没找到');
    }
    return false;
  }
}

async function renderView(root, arg) {
  if (!loadedOnce) {
    const saved = store.articleLoad();
    if (saved && saved.text) article = { ...saved, pasted: true };
    loadedOnce = true;
  }

  if (arg && arg !== appliedArg) {
    appliedArg = arg;
    const [pKey, secId] = String(arg).split('/');
    if (pKey && secId) await loadArticle(pKey, secId);
    else pane = 'paste';
  }

  render(root);
}

export default { title: '阅读', render: renderView, menu };

/* ------------------------- 渲染 ------------------------- */

function render(root) {
  const reading = pane === 'article' && article && article.text;

  root.innerHTML = `
    <button class="picker" data-scope-pick="1">
      <b>${escape(pickerLabel(reading))}</b>
      <em>${escape(pickerHint(reading))}</em>
      <span class="row-caret">⌄</span>
    </button>

    ${reading ? articleHtml() : pasteHtml()}
  `;

  wire(root, reading);
}

function pickerLabel(reading) {
  if (!reading) return '选择一篇文章';
  if (article.pasted) return '我粘贴的文章';
  return article.title || '未命名文章';
}

function pickerHint(reading) {
  if (!reading) return '真题原文 · 或自己的文章';
  if (article.pasted) return '自己粘贴的';
  return article.paperLabel || '真题原文';
}

function articleHtml() {
  return `
    <div class="seg">
      <button class="seg-item${mode === 'lookup' ? ' on' : ''}" data-mode="lookup">点词查义</button>
      <button class="seg-item${mode === 'select' ? ' on' : ''}" data-mode="select">选句拆解</button>
    </div>
    ${article.isCloze ? `
      <div class="hint" style="margin-bottom:var(--s2);color:var(--warn)">
        这是完形填空的原文。20 个空是原始试卷就没印答案词（只标了编号），
        所以句子读起来是断的——这是原文的样子，不是网站出错。
      </div>` : ''}
    <div class="hint" style="margin-bottom:var(--s3)">
      ${mode === 'select'
        ? '点任意句子 → 立刻看句式标注'
        : '点任意单词 → 查看释义并加入生词本'}
    </div>
    <article class="article" id="article"></article>
  `;
}

function pasteHtml() {
  return `
    <div class="hint" style="margin-bottom:var(--s2)">
      也可以把任意英文粘进来——点词查义、选句拆解一样能用，只存在本机。
    </div>
    <textarea id="pasteBox" class="reader-input"
      placeholder="把文章复制粘贴到这里（手机长按粘贴，电脑 Ctrl+V）…"></textarea>
    <div style="display:flex;flex-direction:column;gap:var(--s2);margin-top:var(--s3)">
      <button class="btn primary block" id="useText">开始阅读</button>
      <button class="btn block" id="loadDemo">载入示例文章</button>
    </div>
  `;
}

function wire(root, reading) {
  const pick = root.querySelector('[data-scope-pick]');
  if (pick) pick.onclick = openArticlePicker;

  for (const b of root.querySelectorAll('[data-mode]')) {
    b.onclick = () => { mode = b.dataset.mode; render(root); };
  }

  if (!reading) {
    root.querySelector('#loadDemo').onclick = () => {
      root.querySelector('#pasteBox').value = DEMO;
    };
    root.querySelector('#useText').onclick = () => {
      const text = root.querySelector('#pasteBox').value.trim();
      if (text.length < 20) return toast('内容太短了，先粘贴一段文章');
      article = { title: '未命名文章', source: '阅读器', text, pasted: true };
      store.articleSave(article.title, text);
      pane = 'article';
      mode = 'lookup';
      appliedArg = '';
      render(root);
    };
    return;
  }

  const artEl = root.querySelector('#article');
  artEl.innerHTML = buildArticle(article.text);

  artEl.onclick = (e) => {
    const sentEl = e.target.closest('.sent');
    const wordEl = e.target.closest('.w');
    const sentence = sentEl ? sentIndex[Number(sentEl.dataset.s)] : '';

    if (mode === 'select') {
      if (sentence) {
        // 选句 → 立刻给机器标注，不用先存下来再等人工拆解
        openParseSheet(sentence, article.source || '阅读器');
      }
      return;
    }
    if (!wordEl) return;
    openWordSheet(wordEl.dataset.w, {
      sentence,
      source: article.source || '阅读器',
    }, () => { artEl.innerHTML = buildArticle(article.text); });
  };
}

/* ------------------------- 选文章 ------------------------- */

/** 选择器：先选卷子，再选这一卷里的哪一篇 */
async function openArticlePicker() {
  const papers = await loadPaperIndex();
  openMenu('读哪一篇', [
    {
      label: '我自己的文章',
      hint: '粘贴一段英文',
      action: () => {
        article = null;
        pane = 'paste';
        appliedArg = '';
        render(document.getElementById('view'));
      },
    },
    // 试过一次发现没有原文（公开分享版），就别再让用户一个个点了
    ...(articlesMissing ? [] : papers.map((p) => ({
      label: p.label,
      hint: `${(p.sections || []).length} 篇`,
      action: () => openPaperMenu(p),
    }))),
    ...(articlesMissing ? [{
      label: '真题原文没有收录',
      hint: '这个版本只保留了词表和句式分析',
      disabled: true,
    }] : []),
  ]);
}

function openPaperMenu(paper) {
  openMenu(paper.label, (paper.sections || []).map((s) => ({
    label: s.label + (s.topic ? `　${s.topic}` : ''),
    hint: `${s.words || 0} 词`,
    action: () => pickArticle(paper.key, s.id),
  })));
}

async function pickArticle(pKey, secId) {
  const root = document.getElementById('view');
  // 先把 appliedArg 设好，免得 render 之后又被路由参数重新载入一遍
  appliedArg = `${pKey}/${secId}`;
  if (await loadArticle(pKey, secId)) render(root);
  else appliedArg = '';
}

/* ------------------------- 右上角「⋯」 ------------------------- */

function menu() {
  if (!article || !article.text) return [];
  return [{
    label: `生词标记 ${store.markedList().length}`,
    hint: '在文章里点过「加入生词本」的词',
    action: showMarked,
  }];
}

/* ------------------------- 生词标记 ------------------------- */

function showMarked() {
  const list = store.markedList();
  if (!list.length) return toast('还没有标记生词');
  openSheet(`
    <div class="sheet-title" style="font-size:var(--fs-lg)">生词标记 · ${list.length}</div>
    <div class="sheet-sub">在文章里点过「加入生词本」的词</div>
    <div style="margin-top:var(--s3)">
      ${list.map((w) => `<span class="tag">${escape(w)}</span>`).join(' ')}
    </div>
    <div class="sheet-actions">
      <button class="btn block danger" id="clearMk">清空全部标记</button>
    </div>
  `);
  document.getElementById('clearMk').onclick = () => {
    for (const w of list) store.markWord(w, false);
    closeSheet();
    toast('已清空标记');
    render(document.getElementById('view'));
  };
}

/* ------------------------- 文章渲染 ------------------------- */

function buildArticle(text) {
  const paras = splitParagraphs(text);
  sentIndex = [];
  let html = '';

  for (const p of paras) {
    html += '<p>';
    for (const s of splitSentences(p)) {
      const idx = sentIndex.length;
      sentIndex.push(s);
      html += `<span class="sent" data-s="${idx}">`;
      for (const t of tokenize(s)) {
        if (t.type === 'gap') {
          html += escape(t.text);
        } else if (store.isMarked(t.text)) {
          html += `<span class="w marked" data-w="${escape(t.text)}">${escape(t.text)}</span>`;
        } else {
          html += `<span class="w" data-w="${escape(t.text)}">${escape(t.text)}</span>`;
        }
      }
      html += '</span> ';
    }
    html += '</p>';
  }
  return html;
}

/* ------------------------- 示例文章（自写，非真题） ------------------------- */

const DEMO = `Remote work was once regarded as a privilege granted to a handful of employees, but the past few years have turned it into an arrangement that millions of people now take for granted. What began as an emergency measure has gradually reshaped not only where people work but also how they are judged by their employers.

Advocates argue that workers who are allowed to organize their own schedules tend to be more productive, partly because they can concentrate on demanding tasks during the hours when their attention is sharpest. The commuting time that is saved, they point out, is often reinvested in family life or in skills that make them more valuable in the long run.

Critics, however, warn that the boundary between office and home, once clearly drawn, has become increasingly difficult to maintain. Employees who feel obliged to answer messages at midnight may end up working longer hours than they ever did in a conventional office, even though the total number of hours they are formally paid for has not changed. Whether this arrangement ultimately benefits those it was meant to help remains a question that no one can yet answer with confidence.`;
