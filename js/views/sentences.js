/**
 * 句段：先看段落结构（搭骨架），再看长难句（抠细节）
 *
 * 主旨题和态度题考的是骨架，细节题考的是句子。所以这一页把两层放在一起，
 * 默认只显示段落主旨，想知道为什么就展开。
 *
 * 类型筛选和「看全部」都在右上角「⋯」里。
 */

import * as store from '../store.js';
import { escape } from '../text.js';
import { openMenu, go } from '../ui.js';
import { openWordSheet } from '../wordsheet.js';
import { renderAnalysis, analyzeSentence } from '../parse.js';

let filter = '全部';
let activePaper = '';             // 当前卷 key（'' = 全部卷子）
let paperLabel = '';              // 当前卷的 label，如 "2021 英语二"
let sectionSource = '';           // 具体到某一篇时的完整 source，如 "2021 英语二 Text 1"
let sectionLabel = '';            // 具体到某一篇时的短名，如 "Text 1"
let appliedArg = null;
let paperIndex = null;
const openedSentences = new Set();   // 已展开的长难句 id
const openedPassages = new Set();    // 已展开的段落结构 id
const autoCache = new Map();         // 临时算出来的自动标注（不写回数据）

/**
 * 把路由参数解析成过滤条件。
 *
 *   #/sentences              → 跟随全局「当前卷子」
 *   #/sentences/all          → 不限卷子
 *   #/sentences/2020         → 只看 2020
 *   #/sentences/2020/text1   → 只看这一篇
 */
async function applyArg(arg) {
  activePaper = '';
  paperLabel = '';
  sectionSource = '';
  sectionLabel = '';

  const [pKey, secId] = String(arg || '').split('/');
  // 不带参数时跟随卷子页/词表页刚选的那张卷；'all' 才是真正的不限
  let want = pKey || store.getPaper();
  if (!want || want === 'all') return;

  try {
    const papers = await loadPaperIndex();
    const paper = papers.find((p) => p.key === want);
    if (!paper) return;
    activePaper = paper.key;
    paperLabel = paper.label;
    store.setPaper(paper.key);
    if (secId) {
      const sm = (paper.sections || []).find((s) => s.id === secId);
      if (sm) {
        sectionSource = sm.source;
        sectionLabel = sm.label + (sm.topic ? ` · ${sm.topic}` : '');
      }
    }
  } catch (e) { /* 拿不到就不过滤 */ }
}

/** 把数据里的 **强调** 渲染成粗体（先转义再替换，避免 XSS） */
function rich(s) {
  return escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

function currentData() {
  const inPaper = (src) => {
    if (!src) return !paperLabel;
    if (sectionSource) return src === sectionSource;
    if (paperLabel) return src.startsWith(paperLabel);
    return true;
  };
  const passages = store.allPassages().filter((p) => inPaper(p.source));
  // 「待拆解」是待办清单，不该被范围筛选藏起来——
  // 否则在阅读器里存了句子，切到某一卷就找不到了，会以为丢了
  const all = store.allSentences().filter((s) => s.pending || inPaper(s.source));
  return { passages, all };
}

async function renderView(root, arg) {
  const raw = String(arg || '');
  // 不带参数表示「跟随当前卷子」，而当前卷子随时可能被别的页面改掉，
  // 所以这种情况每次都要重新解析（只看 arg 有没有变会漏掉）
  if (raw !== appliedArg || raw === '') {
    appliedArg = raw;
    await applyArg(raw);
  }
  const papers = await loadPaperIndex();

  const { passages, all } = currentData();

  const pending = all.filter((s) => s.pending);
  const ready = all.filter((s) => !s.pending);

  const types = ['全部', ...new Set(ready.map((s) => s.type).filter(Boolean))];
  const list = filter === '全部' ? ready : ready.filter((s) => s.type === filter);

  root.innerHTML = `
    ${papers.length > 1 ? `
      <div class="seg">
        <button class="seg-item${activePaper ? '' : ' on'}" data-paper="all">全部</button>
        ${papers.map((p) => `<button class="seg-item${p.key === activePaper ? ' on' : ''}"
          data-paper="${escape(p.key)}">${escape(p.key)}</button>`).join('')}
      </div>` : ''}

    ${activePaper ? `
      <button class="picker" data-scope-pick="1">
        <b>${escape(sectionLabel || '整卷 · 全部文章')}</b>
        <em>${passages.length} 篇 · ${all.length} 句</em>
        <span class="row-caret">⌄</span>
      </button>` : ''}

    ${passages.length ? `
      <div class="section">段落结构 · ${passages.length} 篇</div>
      <div class="hint" style="margin-bottom:var(--s3)">
        点开先看骨架。主旨题和态度题靠这一层，不要一上来就抠句子。
      </div>
      ${passages.map(passageCard).join('')}
    ` : ''}

    ${pending.length ? `
      <div class="section">待拆解 · ${pending.length} 句</div>
      <div class="hint" style="margin-bottom:var(--s3)">
        这些是你在阅读器里存下来的句子，还没有做结构分析。
      </div>
      ${pending.map(sentenceCard).join('')}
    ` : ''}

    <div class="section">${filter === '全部' ? '长难句' : escape(filter)} · ${list.length} 句</div>
    ${list.length
      ? list.map(sentenceCard).join('')
      : `<div class="empty">
           <div class="big">⌇</div>
           <div class="t">这里还没有句子</div>
           <div style="margin-top:var(--s2)">去「阅读」打开一篇文章，切到选句拆解，点句子就能存下来。</div>
         </div>`}
  `;

  wire(root, { passages, all, list });
}

/** 右上角「⋯」：只放类型筛选。范围靠页面上那排卷子 + 篇目选择器。 */
function menu() {
  const { all } = currentData();
  const ready = all.filter((s) => !s.pending);
  const types = ['全部', ...new Set(ready.map((s) => s.type).filter(Boolean))];
  const items = [];

  if (types.length > 1) {
    items.push({
      label: filter === '全部' ? '按语法类型筛选…' : `类型：${filter}`,
      hint: `共 ${ready.length} 句`,
      action: () => openMenu('看哪一类', types.map((t) => ({
        label: t,
        hint: t === '全部' ? `全部 ${ready.length} 句` : `${ready.filter((s) => s.type === t).length} 句`,
        action: () => { filter = t; renderView(document.getElementById('view'), appliedArg); },
      }))),
    });
  }
  if (filter !== '全部') {
    items.push({
      label: '类型：看全部',
      action: () => { filter = '全部'; renderView(document.getElementById('view'), appliedArg); },
    });
  }
  return items;
}

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
 * 切换范围。走路由而不是直接重绘——这样地址栏能反映当前选择，
 * 浏览器返回键也能退回上一个范围。
 * @param {string} next 'all' = 不限卷子；'2021' = 整卷；'2021/text1' = 某一篇
 */
function scopeTo(next) {
  go('sentences', String(next || ''));
}

/** 篇目选择器：整卷 + 这一卷的每一篇 */
async function openArticlePicker() {
  const papers = await loadPaperIndex();
  const paper = papers.find((p) => p.key === activePaper);
  if (!paper) return;
  openMenu(paper.label, [
    {
      label: '整卷 · 全部文章',
      hint: `${(paper.sections || []).length} 篇`,
      action: () => scopeTo(paper.key),
    },
    ...(paper.sections || []).map((s) => ({
      label: s.label + (s.topic ? `　${s.topic}` : ''),
      hint: s.analyzed ? `${s.analyzed} 句拆解` : '',
      action: () => scopeTo(`${paper.key}/${s.id}`),
    })),
  ]);
}

export default { title: '句式', render: renderView, menu };

/* ------------------------- 事件 ------------------------- */

function wire(root, { all }) {
  for (const b of root.querySelectorAll('[data-paper]')) {
    b.onclick = () => scopeTo(b.dataset.paper);
  }
  const pick = root.querySelector('[data-scope-pick]');
  if (pick) pick.onclick = openArticlePicker;

  for (const el of root.querySelectorAll('[data-pid]')) {
    el.onclick = () => {
      const id = el.dataset.pid;
      if (openedPassages.has(id)) openedPassages.delete(id); else openedPassages.add(id);
      renderView(root, appliedArg);
    };
  }

  for (const el of root.querySelectorAll('[data-sid]')) {
    el.onclick = () => {
      const id = el.dataset.sid;
      if (openedSentences.has(id)) openedSentences.delete(id); else openedSentences.add(id);
      renderView(root, appliedArg);
    };
  }

  for (const b of root.querySelectorAll('[data-parse]')) {
    b.onclick = (e) => {
      e.stopPropagation();
      const s = all.find((x) => x.id === b.dataset.parse);
      if (!s) return;
      autoCache.set(s.id, analyzeSentence(s.en));
      renderView(root, appliedArg);
    };
  }

  for (const chip of root.querySelectorAll('[data-w]')) {
    chip.onclick = (e) => {
      e.stopPropagation();
      openWordSheet(chip.dataset.w, {
        sentence: chip.dataset.s || '',
        source: chip.dataset.src || '',
      }, () => renderView(root, appliedArg));
    };
  }
}

/* ------------------------- 段落结构 ------------------------- */

function passageCard(p) {
  const open = openedPassages.has(p.id);
  const paras = p.paragraphs || [];

  return `
    <div class="card tap" data-pid="${p.id}">
      <div class="card-head">
        <span class="card-title">${escape(p.topic || '')}</span>
        ${p.type ? `<span class="tag brand">${escape(p.type)}</span>` : ''}
      </div>
      <div class="card-meta">
        ${p.source ? `<span class="tag">${escape(p.source)}</span>` : ''}
        <span class="card-more">${open ? '收起 ⌃' : '展开 ⌄'}</span>
      </div>

      ${open ? `
        <div class="card-body">
          ${p.mainIdea ? structRow('主旨', rich(p.mainIdea)) : ''}
          ${p.structure ? structRow('结构', `<span class="mute">${escape(p.structure)}</span>`) : ''}
          <div style="margin-top:var(--s3)">
            ${paras.map((par) => `
              <div class="para">
                <div class="para-n">${par.n}</div>
                <div class="para-body">
                  <div class="para-role">${escape(par.role || '')}</div>
                  <div class="para-gist">${rich(par.gist || '')}</div>
                  ${par.note ? `<div class="para-note">${rich(par.note)}</div>` : ''}
                </div>
              </div>`).join('')}
          </div>
        </div>
      ` : `
        <div class="hint" style="margin-top:var(--s3)">${rich((p.mainIdea || '').slice(0, 60))}…</div>
      `}
    </div>
  `;
}

/* ------------------------- 长难句 ------------------------- */

function sentenceCard(s) {
  const isOpen = openedSentences.has(s.id);
  const words = s.words || [];

  return `
    <div class="card tap" data-sid="${s.id}">
      <div class="card-en">${escape(s.en)}</div>
      <div class="card-meta">
        ${s.type ? `<span class="tag brand">${escape(s.type)}</span>` : ''}
        ${s.source ? `<span class="tag">${escape(s.source)}</span>` : ''}
        ${s.pending ? '<span class="tag warn">待拆解</span>' : ''}
        <span class="card-more">${isOpen ? '收起 ⌃' : '拆解 ⌄'}</span>
      </div>

      ${isOpen ? `
        <div class="card-body">
          ${s.main ? structRow('主干', escape(s.main)) : ''}
          ${(s.clauses || []).map((c) => structRow(
              c.part || '成分',
              `${escape(c.text || '')}${c.note ? `<br><span class="mute">${escape(c.note)}</span>` : ''}`
            )).join('')}
          ${s.bracket ? structRow('括号化', `<div class="bracket">${escape(s.bracket)}</div>`) : ''}
          ${s.cn ? structRow('翻译', escape(s.cn)) : ''}
          ${(s.points || []).length
            ? structRow('考点', s.points.map((x) => `<div>· ${escape(x)}</div>`).join(''))
            : ''}
          ${words.length
            ? structRow('生词', words.map((w) => `
                <span class="tag brand" style="cursor:pointer"
                      data-w="${escape(w)}" data-s="${escape(s.en)}" data-src="${escape(s.source || '')}">${escape(w)}</span>`).join(' '))
            : ''}
          ${s.pending ? pendingBody(s) : ''}
        </div>
      ` : `
        <div class="hint" style="margin-top:var(--s3)">先在心里划出主干和从句，再点开对照。</div>
      `}
    </div>
  `;
}

/** 「待拆解」句子的补充内容：机器标注结果，或一个生成按钮 */
function pendingBody(s) {
  const cached = autoCache.get(s.id);
  const auto = cached || s.auto;

  if (auto) {
    return `
      <div class="hint" style="margin:var(--s3) 0 var(--s2)">
        ${s.auto ? '你保存时的机器标注' : '机器标注'}（先自己划一遍再看）
      </div>
      ${renderAnalysis({ chunks: auto.chunks || [], main: auto.main || '', bracket: auto.bracket || '' })}
      ${s.cn ? structRow('我的翻译', escape(s.cn)) : ''}
    `;
  }

  return `
    <div class="hint" style="margin-top:var(--s3)">这一句还没有结构分析。</div>
    <button class="btn block" data-parse="${escape(s.id)}" style="margin-top:var(--s2)">
      自动标注一下
    </button>
  `;
}

function structRow(label, html) {
  return `<div class="kv"><b>${escape(label)}</b><div>${html}</div></div>`;
}
