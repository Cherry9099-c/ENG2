/**
 * 卷子（一级界面）
 *
 * 一屏只做两件事：
 *   1. 选哪一年哪张卷子
 *   2. 点一篇文章进去（刷词 / 读原文 / 拆句式），或者整卷刷单词
 *
 * 次要操作（清空刷词记录）收进右上角「⋯」。
 */

import * as store from '../store.js';
import { go, openSheet, closeSheet } from '../ui.js';
import { escape } from '../text.js';
import { setCurrentPaper } from './wordlist.js';

let index = null;
let key = null;

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[papers] 载入失败', url, e);
    return null;
  }
}

/**
 * 篇目的话题和行文类型在 data/passages/ 里（那是句式分析的产物）。
 * 词表清单里也有 topic，但只有 2021 卷填过，2020 / 2007 全是空的——
 * 所以这里补读一次，让三张卷子的文章行长得一样。
 * 读不到就退化成用词表清单里的值，不会报错。
 */
const passageMetaCache = new Map();

async function loadPassageMeta(paperKey) {
  if (passageMetaCache.has(paperKey)) return passageMetaCache.get(paperKey);
  const map = new Map();
  const d = await fetchJSON(`data/passages/${paperKey}.json`);
  for (const p of (d && d.passages) || []) {
    map.set(p.source, { topic: p.topic || '', type: p.type || '' });
  }
  passageMetaCache.set(paperKey, map);
  return map;
}

/** 话题在行内只占一行，太长的（比如写作题的）截断，完整内容在弹层里看 */
function clip(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

async function renderView(root, arg) {
  if (!index) {
    root.innerHTML = '<div class="empty">正在载入…</div>';
    index = await fetchJSON('data/wordlists/index.json');
    if (!index || !index.wordlists || !index.wordlists.length) {
      root.innerHTML = `<div class="empty">
        <div class="big">▤</div>
        <div class="t">还没有生成词表</div>
        <div style="margin-top:var(--s3)">在项目目录执行：<br>
          <span class="mono">node tools/build-wordlist.js</span>
        </div>
      </div>`;
      return;
    }
    key = store.getPaper() || index.wordlists[0].key;
  }
  // 路由参数优先；否则跟随全局「当前卷子」——可能在词表或句式页刚换过
  if (arg && index.wordlists.some((p) => p.key === arg)) {
    key = arg;
  } else {
    const shared = store.getPaper();
    if (shared && index.wordlists.some((p) => p.key === shared)) key = shared;
  }
  if (!index.wordlists.some((p) => p.key === key)) key = index.wordlists[0].key;
  store.setPaper(key);          // 把结果写回共享状态，其它页面跟着走

  const paper = index.wordlists.find((p) => p.key === key) || index.wordlists[0];
  const st = store.drillStats(key);
  const s = paper.stats || {};
  const sections = paper.sections || [];
  const pm = await loadPassageMeta(key);
  const metaOf = (sec) => pm.get(sec.source) || {};

  const pct = s.total ? Math.round((st.total / s.total) * 100) : 0;

  root.innerHTML = `
    ${index.wordlists.length > 1 ? `
      <div class="seg">
        ${index.wordlists.map((p) => `
          <button class="seg-item${p.key === key ? ' on' : ''}" data-paper="${escape(p.key)}">
            ${escape(p.label)}
          </button>`).join('')}
      </div>` : ''}

    <div class="paper-hero">
      <div class="paper-name">${escape(paper.label)}</div>
      <div class="paper-meta"><b>${s.total || 0}</b> 词 · ${sections.length} 篇</div>
      <div class="paper-tiers">
        <span class="tag ink">考点 ${s.t1 || 0}</span>
        <span class="tag brand">核心 ${s.t2 || 0}</span>
        <span class="tag">大纲 ${s.t3 || 0}</span>
        <span class="tag">基础 ${s.t4 || 0}</span>
      </div>
      ${st.total ? `
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="hint" style="margin-top:var(--s2)">
          已刷 <b>${st.total}</b> / ${s.total || 0}（${pct}%）
          ${st.unknown + st.shaky ? ` · <span style="color:var(--warn)">待巩固 ${st.unknown + st.shaky}</span>` : ''}
        </div>` : ''}
    </div>

    <button class="btn primary block big" data-act="drill-all">
      ${st.total ? '继续刷单词' : '开始刷单词'}
    </button>

    ${sectionGroup('阅读 Text 1-4', sections.filter((x) => x.id.startsWith('text')), metaOf)}
    ${sectionGroup('其他题型', sections.filter((x) => !x.id.startsWith('text')), metaOf)}
  `;

  for (const b of root.querySelectorAll('[data-paper]')) {
    b.onclick = () => {
      key = b.dataset.paper;
      setCurrentPaper(key);      // 让词表 / 句式两页也跟着换卷
      renderView(root);
    };
  }
  for (const b of root.querySelectorAll('[data-sec]')) {
    b.onclick = () => openSectionSheet(paper, b.dataset.sec, pm);
  }
  for (const el of root.querySelectorAll('[data-act]')) {
    el.onclick = () => go('drill', key);
  }
}

/** 右上角「⋯」里的次要操作 */
function menu() {
  if (!key) return [];
  const st = store.drillStats(key);
  if (!st.total) return [];
  return [{
    label: '清空本卷刷词记录',
    hint: `已刷 ${st.total} 个`,
    danger: true,
    action: () => {
      store.drillReset(key);
      const root = document.getElementById('view');
      if (root) renderView(root);
    },
  }];
}

export default { title: '卷子', render: renderView, menu };

/* ------------------------- 文章行 ------------------------- */

function sectionGroup(title, list, metaOf) {
  if (!list.length) return '';
  return `
    <div class="section">${escape(title)}</div>
    <div class="row-list">
      ${list.map((sec) => sectionRow(sec, metaOf(sec))).join('')}
    </div>
  `;
}

function sectionMeta(sec) {
  const bits = [`${sec.words} 词`];
  if (sec.paragraphs) bits.push(`${sec.paragraphs} 段`);
  if (sec.analyzed) bits.push(`${sec.analyzed} 句拆解`);
  return bits.join(' · ');
}

/** 话题优先用句式分析里的（三张卷子都有），退回到词表清单里的 */
function topicOf(sec, meta) {
  return String(sec.topic || (meta && meta.topic) || '').trim();
}

function sectionRow(sec, meta) {
  const topic = topicOf(sec, meta);
  return `
    <button class="row-item" data-sec="${escape(sec.id)}">
      <span class="row-body">
        <span class="row-title">${escape(sec.label)}${topic ? `　${escape(clip(topic, 18))}` : ''}</span>
        <span class="row-sub">${sectionMeta(sec)}</span>
      </span>
      <span class="row-caret">›</span>
    </button>
  `;
}

/** 点一篇文章 → 弹出三个动作，避免一级页面堆满按钮 */
function openSectionSheet(paper, secId, pm) {
  const sec = (paper.sections || []).find((s) => s.id === secId);
  if (!sec) return;

  const meta = (pm && pm.get(sec.source)) || {};
  const topic = topicOf(sec, meta);
  const type = String(meta.type || sec.type || '').trim();

  openSheet(`
    <div class="sheet-title" style="font-size:var(--fs-lg)">
      ${escape(sec.label)}${topic ? ` · ${escape(topic)}` : ''}
    </div>
    <div class="sheet-sub">${sectionMeta(sec)}${type ? ` · ${escape(type)}` : ''}</div>
    ${sec.preview ? `<div class="sheet-quote">${escape(sec.preview)}…</div>` : ''}

    <div class="sheet-actions">
      <button class="btn primary block" data-a="drill">刷这篇的词</button>
      <button class="btn block" data-a="read">读原文</button>
      <button class="btn block" data-a="sent">看句式拆解</button>
    </div>
  `);

  for (const b of document.querySelectorAll('#sheetBody [data-a]')) {
    b.onclick = () => {
      const a = b.dataset.a;
      closeSheet();
      if (a === 'drill') go('drill', `${paper.key}/${sec.id}`);
      else if (a === 'read') go('reader', `${paper.key}/${sec.id}`);
      else go('sentences', `${paper.key}/${sec.id}`);
    };
  }
}
