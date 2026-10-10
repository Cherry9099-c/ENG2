/**
 * 词表模块 —— 导出两个独立界面
 *
 *   drillView  「刷单词」：一屏一个词 + 三档打分（不认识 / 不熟 / 认识）
 *   listView   「完整词表」：四档浏览全部词 + 重点短语
 *
 * 两者共用同一份词表数据和「当前卷子」，但各自是独立的界面和路由
 * （#/drill/2021/text1 和 #/wordlist/2021），不再是同一个页面里的模式切换。
 *
 * 刷词进度单独存（和 SM-2 记录分开），所以可以随时中断、随时接着刷。
 */

import * as store from '../store.js';
import { QUALITY } from '../srs.js';
import { escape } from '../text.js';
import { go, toast, openMenu } from '../ui.js';

const TIER = {
  1: { name: '考点', desc: '精选成卡片的词，做题直接受影响' },
  2: { name: '核心', desc: '考研高频核心词' },
  3: { name: '大纲', desc: '要认识，未必是考点' },
  4: { name: '基础', desc: '认识即可，默认折叠' },
};

const PAGE = 80;

/* ------------------------- 共享状态 ------------------------- */

let index = null;
let key = null;                // 当前卷子（刷词和词表共用）
let data = null;               // 当前卷子的词表
let loadToken = 0;
let drillArg = null;           // 已应用的 #/drill/* 参数
let listArg = null;            // 已应用的 #/wordlist/* 参数
let pendingSection = '';       // 待解析的 section（等数据载入后才知道 label）
let scope = 'all';             // all | fresh | hard
let secFilter = '全部';
let onlyDefined = false;
let drill = null;              // { paper, list, total, i, revealed, marks, again, done, start }
let activeView = 'drill';      // 当前渲染的是哪个界面（供 rerender 用）

const openTier = { 1: true, 2: true, 3: true, 4: false };
const limit = { 1: PAGE, 2: PAGE, 3: PAGE, 4: PAGE };
const expanded = new Set();

/**
 * 「当前卷子」是跨界面的状态：在卷子页换了卷，词表和句式两页也应该跟着换。
 * 真正的值存在 store 里（还落盘），这里只是一个本地缓存 + 触发重新载入。
 */
export function setCurrentPaper(k) {
  if (!k) return;
  store.setPaper(k);
  if (k === key) return;
  key = k;
  data = null;                 // 下次渲染重新载入
  drill = null;
  secFilter = '全部';
  expanded.clear();
}

async function fetchJSON(url) {
  try {
    // no-cache：词表重新生成后要能立刻看到，不能被浏览器旧缓存挡住
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[wordlist] 载入失败', url, e);
    return null;
  }
}

function ensureIndex(root) {
  if (index) return true;
  return fetchJSON('data/wordlists/index.json').then((d) => {
    if (!d || !d.wordlists || !d.wordlists.length) {
      root.innerHTML = `<div class="empty">
        <div class="big">▤</div>
        <div class="t">还没有生成词表</div>
        <div style="margin-top:var(--s3)">在项目目录执行：<br>
          <span class="mono">node tools/build-wordlist.js</span></div>
      </div>`;
      return false;
    }
    index = d;
    // 优先用全局的「当前卷子」，其次第一张卷子；不在清单里就退回第一张
    key = key || store.getPaper() || d.wordlists[0].key;
    if (!d.wordlists.some((p) => p.key === key)) key = d.wordlists[0].key;
    return true;
  });
}

async function ensureData(root) {
  if (data && data.key === key) return true;
  root.innerHTML = '<div class="empty">正在载入词表…</div>';

  const tok = ++loadToken;
  const wantKey = key;
  const d = await fetchJSON(`data/wordlists/${wantKey}.json`);

  // 两个条件都要判：令牌变了说明有更新的加载；key 变了说明用户在等待期间又切了卷子。
  // 只判令牌会漏掉一种情况——第二次调用发现 data.key === key 直接跳过加载、
  // 于是令牌没变，第一次的旧数据回来时被当成了有效结果，
  // 结果 2020 的词被塞进 2021 的状态里，刷词记录就「跑」到别的卷子上了。
  if (tok !== loadToken || wantKey !== key) return false;
  if (!d) { root.innerHTML = '<div class="empty">词表载入失败，刷新试试</div>'; return false; }
  if (d.key !== key) return false;

  data = d;
  // 换卷子就把上一轮作废：队列里的词是旧卷子的，留着会张冠李戴。
  // （已经打过的分早就写进 localStorage 了，不会丢。）
  if (drill && drill.paper !== key) drill = null;
  expanded.clear();
  secFilter = '全部';
  for (const t of [1, 2, 3, 4]) limit[t] = PAGE;
  return true;
}

/* ========================= 界面一：刷单词 ========================= */

async function renderDrillView(root, arg) {
  activeView = 'drill';
  if (!await ensureIndex(root)) return;

  if (arg !== drillArg) {
    drillArg = arg;
    const [aKey, aSec] = String(arg || '').split('/');
    if (aKey) key = aKey;
    pendingSection = aSec || '';
    drill = null;
  }

  if (!await ensureData(root)) return;

  // 把路由里的 section id 解析成实际的 section 标签
  if (pendingSection) {
    const sm = (data.sections || []).find((s) => s.id === pendingSection);
    if (sm) secFilter = sm.label;
    pendingSection = '';
    drill = null;
  }

  renderDrill(root);
}

/** 刷词页的「⋯」：范围、篇目、清空。页面上只留三个评分按钮。 */
function drillMenu() {
  if (!data) return [];
  const running = drill && drill.marks.size > 0 && !drill.done;
  const st = store.drillStats(key);
  const items = [
    { label: `范围：全部（${drillQueue().length}）`, action: () => setScope('all') },
    { label: '范围：没刷过', action: () => setScope('fresh') },
    { label: `范围：不熟的 ${st.unknown + st.shaky}`, action: () => setScope('hard') },
  ];
  items.push(...sectionMenuItems());
  items.push(onlyDefinedItem());
  if (running) {
    items.push({ label: '结束本轮', hint: `已过 ${drill.marks.size} 个`, action: endRound });
  }
  items.push(resetItem(st));
  return items;
}

export const drillView = {
  title: '刷单词',
  focus: true,
  render: renderDrillView,
  menu: drillMenu,
};

/* ========================= 界面二：完整词表 ========================= */

async function renderListView(root, arg) {
  activeView = 'list';
  if (!await ensureIndex(root)) return;

  const raw = String(arg || '');
  if (raw !== listArg) {
    listArg = raw;
    const [aKey] = raw.split('/');
    if (aKey) key = aKey;
  } else if (!raw) {
    // 没带卷子参数：跟随全局「当前卷子」——在卷子页或句式页刚换过卷的话
    const shared = store.getPaper();
    if (shared && shared !== key) { key = shared; data = null; drill = null; }
  }
  store.setPaper(key);

  if (!await ensureData(root)) return;
  renderList(root);
}

/** 右上角「⋯」：篇目靠页面上的选择器，这里只留「只看有释义」和清空 */
function listMenu() {
  if (!data) return [];
  const st = store.drillStats(key);
  return [
    onlyDefinedItem(),
    resetItem(st),
  ];
}

export const listView = {
  title: '完整词表',
  render: renderListView,
  menu: listMenu,
};

/* ========================= 菜单片段 ========================= */

function sectionMenuItems() {
  const secs = sectionsIn();
  const items = [];
  if (secs.length > 1) {
    items.push({
      label: secFilter === '全部' ? '只看某一篇…' : `只看：${secFilter}`,
      hint: '按文章缩小范围',
      action: () => openMenu('只看哪一篇', secs.map((s) => ({
        label: s,
        hint: s === '全部'
          ? '整卷'
          : `${data.words.filter((w) => (w.sections || []).includes(s)).length} 词`,
        action: () => setScope(scope, s),
      }))),
    });
  }
  if (secFilter !== '全部') {
    items.push({ label: '恢复整卷', action: () => setScope(scope, '全部') });
  }
  return items;
}

function onlyDefinedItem() {
  return {
    label: onlyDefined ? '只看有释义：开' : '只看有释义：关',
    hint: `有释义 ${data.words.filter((w) => w.cn).length} / ${data.words.length}`,
    action: () => {
      onlyDefined = !onlyDefined;
      for (const t of [1, 2, 3, 4]) limit[t] = PAGE;
      drill = null;
      rerender();
    },
  };
}

function resetItem(st) {
  return {
    label: '清空本卷刷词记录',
    hint: `已刷 ${st.total} 个`,
    danger: true,
    action: () => {
      store.drillReset(key);
      drill = null;
      toast('已清空本卷刷词记录');
      rerender();
    },
  };
}

/* ------------------------- 页内动作 ------------------------- */

function rootEl() { return document.getElementById('view'); }

function rerender() {
  const root = rootEl();
  if (!root) return;
  if (activeView === 'list') renderList(root);
  else renderDrill(root);
}

function setScope(s, sec) {
  scope = s;
  if (sec !== undefined) secFilter = sec;
  drill = null;
  for (const t of [1, 2, 3, 4]) limit[t] = PAGE;
  rerender();
}

function endRound() {
  if (!drill) return;
  drill.done = true;
  rerender();
}

/* ------------------------- 公共片段 ------------------------- */

/**
 * 卷子选择器。
 * 刷词进行中（已经打过分、还没结束）时锁定其它卷子——
 * 刷到一半手滑点到别的卷子，这一轮的位置和小结就没了。
 * 词表页也一起锁：否则在词表里换卷子会把这轮刷词的队列作废。
 */
function paperSeg(locked) {
  const papers = index?.wordlists || [];
  if (papers.length < 2) return '';
  return `
    <div class="seg">
      ${papers.map((p) => {
        const isCur = p.key === key;
        const dis = !!locked && !isCur;
        return `<button class="seg-item${isCur ? ' on' : ''}" data-paper="${escape(p.key)}"
          ${dis ? 'disabled' : ''}>${dis ? '🔒 ' : ''}${escape(p.label)}</button>`;
      }).join('')}
    </div>`;
}

function sectionsIn() {
  const set = new Set();
  for (const w of data.words) for (const s of w.sections || []) set.add(s);
  return ['全部', ...[...set].sort()];
}

function roundRunning() {
  return !!(drill && drill.marks.size > 0 && !drill.done);
}

/**
 * 换卷子。
 *
 * 换完**必须重新载入这一卷的词表**再渲染。早先这里只改了 key 就直接重绘，
 * 于是列表里还是上一张卷子的词——用户报的「切换卷子仍是同样的单词」就是这个。
 */
async function switchPaper(root, nextKey) {
  if (!nextKey || nextKey === key) return;
  if (roundRunning()) { toast('刷词进行中，先结束本轮再换卷子'); return; }
  key = nextKey;
  drill = null;
  store.setPaper(key);
  // 载入失败、或被更新的请求顶掉时不要渲染，否则会把旧卷子的词当成新卷子的
  if (!await ensureData(root)) return;
  if (activeView === 'list') renderList(root);
  else renderDrill(root);
}

/* ========================= 刷词 ========================= */

function drillQueue() {
  const marks = store.drillGet(key);
  let list = data.words;
  if (secFilter !== '全部') list = list.filter((w) => (w.sections || []).includes(secFilter));
  if (onlyDefined) list = list.filter((w) => w.cn);
  if (scope === 'fresh') list = list.filter((w) => !marks[w.term]);
  else if (scope === 'hard') {
    list = list.filter((w) => marks[w.term] === 'unknown' || marks[w.term] === 'shaky');
  }
  return list;
}

function newDrill() {
  const list = drillQueue();
  return {
    paper: key,
    list,
    // 分母固定：标了「不认识/不熟」的词会重新排进队列，list.length 会涨。
    // 之前进度条直接用 list.length 当分母，所以每标一个「不认识」总数就变大。
    total: list.length,
    i: 0,
    revealed: false,
    marks: new Map(),      // 本轮每个词的最后一次评分（同一个词重复评分只算一次）
    again: new Set(),      // 本轮已经因「不认识/不熟」排到队尾的词
    done: false,
    start: Date.now(),
  };
}

/** 本轮各档计数 */
function tally(d) {
  const out = { unknown: 0, shaky: 0, known: 0, total: 0 };
  for (const v of d.marks.values()) { out[v] += 1; out.total += 1; }
  return out;
}

function scopeHint() {
  const bits = [];
  if (secFilter !== '全部') bits.push(`只刷 ${secFilter}`);
  if (scope === 'fresh') bits.push('只刷没刷过的');
  if (scope === 'hard') bits.push('只刷不熟的');
  return bits.join(' · ');
}

function renderDrill(root) {
  if (!drill || drill.paper !== key) drill = newDrill();

  const st = store.drillStats(key);
  const running = roundRunning();
  const hint = scopeHint();

  const head = `
    ${paperSeg(running)}
    ${running ? '<div class="hint">🔒 刷词进行中，卷子已锁定</div>' : ''}
    ${hint ? `<div class="hint">${escape(hint)}</div>` : ''}
  `;

  if (!drill.list.length) {
    root.innerHTML = head + `<div class="empty">
      <div class="big">✓</div>
      <div class="t">${scope === 'fresh' ? '这张卷子的词都刷过了'
        : scope === 'hard' ? '还没有标记「不认识」或「不熟」的词' : '这个筛选下没有词'}</div>
      <div style="margin-top:var(--s4);display:flex;flex-direction:column;gap:var(--s2)">
        <button class="btn block" data-scope="all">看全部</button>
        <button class="btn primary block" data-golist="1">看完整词表</button>
      </div>
    </div>`;
    wireDrill(root);
    return;
  }

  if (drill.done || drill.i >= drill.list.length) {
    root.innerHTML = head + summaryHtml();
    wireDrill(root);
    return;
  }

  const w = drill.list[drill.i];
  const total = drill.total;
  const done = drill.marks.size;                                   // 已过的不重复词数
  const remain = Math.max(0, drill.list.length - drill.i);         // 含重新排进来的
  // 精讲卡片里有手写的「本文义」和笔记——复习页去掉之后，这里是唯一能看到它们的地方
  const card = store.findCardByTerm(w.term);

  root.innerHTML = head + `
    <div class="drill-progress">
      <span class="n">${done} / ${total}</span>
      <div style="flex:1"><div class="bar"><i style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div></div>
      <button class="btn sm bare" id="drillEnd">结束</button>
    </div>

    ${st.total ? `
      <div class="hint center" style="margin-bottom:var(--s3)">
        本卷累计已刷 ${st.total} / ${data.words.length}
        · <span style="color:var(--bad)">不认识 ${st.unknown}</span>
        · <span style="color:var(--warn)">不熟 ${st.shaky}</span>
        · <span style="color:var(--ok)">认识 ${st.known}</span>
      </div>` : ''}

    <div class="word-card" id="drillCard">
      <span class="tier tag ${w.tier === 1 ? 'ink' : w.tier === 2 ? 'brand' : ''}">${TIER[w.tier].name}</span>
      <div class="word-main${w.term.includes(' ') ? ' phrase' : ''}">${escape(w.term)}</div>
      ${w.phon ? `<div class="word-phon">/${escape(w.phon)}/</div>` : ''}
      <div class="word-src">
        ${w.pos ? `<span class="pos">${escape(w.pos)}</span> · ` : ''}${escape(w.source || '')}
        ${w.count > 1 ? ` · 出现 ${w.count} 次` : ''}
      </div>

      ${drill.revealed ? `
        <div class="word-answer">
          <div class="word-mean">${w.cn ? escape(w.cn) : '<span class="mute">（词库暂缺释义）</span>'}</div>
          ${card && card.sense ? `<div class="word-sense"><b>本文义</b>　${escape(card.sense)}</div>` : ''}
          ${w.sentence ? `<div class="word-trans">${escape(w.sentence)}</div>` : ''}
          ${card && card.note ? `<div class="word-note">💡 ${escape(card.note)}</div>` : ''}
          ${card ? '<div class="word-tap">✓ 已在生词本里</div>' : ''}
        </div>
      ` : '<div class="word-tap">想不起来就点一下卡片</div>'}
    </div>

    ${remain > total - done ? `<div class="hint center">还有 ${remain} 个待过（含本轮重排的）</div>` : ''}

    <div class="grades">
      <button class="grade bad"  data-lv="unknown"><b>不认识</b><span>1</span></button>
      <button class="grade warn" data-lv="shaky"><b>不熟</b><span>2</span></button>
      <button class="grade ok"   data-lv="known"><b>认识</b><span>3</span></button>
    </div>
    <div class="hint center" style="margin-top:var(--s2)">电脑上：空格看释义，1 / 2 / 3 打分</div>
  `;
  wireDrill(root);
}

function summaryHtml() {
  const d = drill;
  const t = tally(d);
  const mins = Math.max(1, Math.round((Date.now() - d.start) / 60000));
  const uniqHard = [...d.marks.entries()]
    .filter(([, lv]) => lv === 'unknown' || lv === 'shaky')
    .map(([term]) => data.words.find((w) => w.term === term) || { term, cn: '' });

  return `
    <div class="empty" style="padding-bottom:var(--s3)">
      <div class="big">${t.total ? '🎉' : '·'}</div>
      <div class="t">这一轮刷完了</div>
      <div style="margin-top:var(--s2)">${t.total} 个词 · 用时约 ${mins} 分钟</div>
    </div>

    <div class="row-list">
      <div class="row-item static">
        <span class="row-body"><span class="row-title">不认识</span></span>
        <span class="row-tail" style="color:var(--bad)">${t.unknown}</span>
      </div>
      <div class="row-item static">
        <span class="row-body"><span class="row-title">不熟</span></span>
        <span class="row-tail" style="color:var(--warn)">${t.shaky}</span>
      </div>
      <div class="row-item static">
        <span class="row-body"><span class="row-title">认识</span></span>
        <span class="row-tail" style="color:var(--ok)">${t.known}</span>
      </div>
    </div>

    <div class="hint center" style="margin-bottom:var(--s4)">
      不认识和不熟的词已经记进生词本，统计页能看到掌握程度。
    </div>

    ${uniqHard.length ? `
      <div class="section">这一轮标记的词 · ${uniqHard.length}</div>
      <div style="margin-bottom:var(--s3)">
        ${uniqHard.slice(0, 40).map((w) => {
          const lv = d.marks.get(w.term);
          return `<div class="rank">
            <b>${escape(w.term)}</b>
            <span class="mute" style="font-size:var(--fs-xs)">${escape((w.cn || '').slice(0, 14))}</span>
            <span class="n" style="color:${lv === 'unknown' ? 'var(--bad)' : 'var(--warn)'}">${lv === 'unknown' ? '不认识' : '不熟'}</span>
          </div>`;
        }).join('')}
      </div>
      ${uniqHard.length > 40 ? `<div class="hint center">还有 ${uniqHard.length - 40} 个…</div>` : ''}
    ` : ''}

    <div style="display:flex;flex-direction:column;gap:var(--s2)">
      <button class="btn primary block" id="drillRestart">再刷一轮</button>
      <button class="btn block" data-scope="hard">只刷这一轮标记的</button>
      <button class="btn block" data-golist="1">去看完整词表</button>
    </div>
  `;
}

/** 记进生词本，并记一次 SM-2 评级（用来算掌握程度） */
function rememberWord(w, level) {
  let card = store.findCardByTerm(w.term);
  if (!card) {
    card = store.addUserCard({
      type: w.term.includes(' ') ? 'phrase' : 'word',
      term: w.term,
      phon: w.phon || '',
      pos: w.pos || '',
      cn: w.cn || '（待补充释义）',
      context: w.sentence ? { sentence: w.sentence, source: w.source || '' } : undefined,
      source: w.source || '刷词',
      tags: ['刷词'],
    });
  }
  if (!card) return;
  const q = level === 'unknown' ? QUALITY.AGAIN : level === 'shaky' ? QUALITY.HARD : QUALITY.GOOD;
  store.recordReview(card.id, q);
}

function grade(root, w, level) {
  store.drillMark(key, w.term, level);
  drill.marks.set(w.term, level);

  if (level === 'known') {
    if (store.findCardByTerm(w.term)) rememberWord(w, 'known');
  } else {
    rememberWord(w, level);
    // 本轮稍后再出现一次，同一个词只加回一次
    if (!drill.again.has(w.term)) {
      drill.again.add(w.term);
      drill.list.push(w);
    }
  }

  drill.i += 1;
  drill.revealed = false;
  if (drill.i >= drill.list.length) drill.done = true;
  renderDrill(root);
}

function wireDrill(root) {
  for (const b of root.querySelectorAll('[data-paper]')) {
    b.onclick = () => switchPaper(root, b.dataset.paper);
  }
  for (const b of root.querySelectorAll('[data-scope]')) {
    b.onclick = () => setScope(b.dataset.scope);
  }
  for (const b of root.querySelectorAll('[data-golist]')) {
    b.onclick = () => go('wordlist', key);
  }
  for (const b of root.querySelectorAll('[data-lv]')) {
    b.onclick = () => grade(root, drill.list[drill.i], b.dataset.lv);
  }
  const card = root.querySelector('#drillCard');
  if (card) card.onclick = () => { drill.revealed = true; renderDrill(root); };

  const restart = root.querySelector('#drillRestart');
  if (restart) restart.onclick = () => { drill = null; renderDrill(root); };

  const end = root.querySelector('#drillEnd');
  if (end) end.onclick = () => endRound();
}

/* ========================= 完整词表 ========================= */

function renderList(root) {
  if (!data) return;
  let words = data.words;
  if (secFilter !== '全部') words = words.filter((w) => (w.sections || []).includes(secFilter));
  if (onlyDefined) words = words.filter((w) => w.cn);

  const byTier = { 1: [], 2: [], 3: [], 4: [] };
  for (const w of words) byTier[w.tier].push(w);
  const marks = store.drillGet(key);
  const st = store.drillStats(key);

  root.innerHTML = `
    ${paperSeg(roundRunning())}

    <button class="picker" data-scope-pick="1">
      <b>${escape(sectionTitle())}</b>
      <em>${words.length} 词${secFilter !== '全部' ? ` / 全卷 ${data.words.length}` : ''}</em>
      <span class="row-caret">⌄</span>
    </button>

    <div class="card-head" style="margin-bottom:var(--s3)">
      <span class="card-title">${words.length} 个词</span>
      ${onlyDefined ? '<span class="tag brand">只看有释义</span>' : ''}
      ${st.total ? `<span class="card-more">已刷 ${st.total}</span>` : ''}
    </div>

    ${[1, 2, 3, 4].map((t) => tierBlock(t, byTier[t], marks)).join('')}

    ${data.phrases && data.phrases.length ? phrasesBlock(data.phrases) : ''}
  `;
  wireList(root);
}

/** 当前篇目的显示名（整卷 / Text 1 · 话题） */
function sectionTitle() {
  if (secFilter === '全部') return '整卷 · 全部文章';
  const sm = (data.sections || []).find((s) => s.label === secFilter);
  return sm ? escape(sm.label) + (sm.topic ? ` · ${escape(sm.topic)}` : '') : secFilter;
}

/** 篇目选择器：整卷 + 这一卷的每一篇 */
function openSectionPicker() {
  if (!data) return;
  const countOf = (label) => data.words.filter((w) => (w.sections || []).includes(label)).length;
  openMenu('看哪一篇', [
    { label: '整卷 · 全部文章', hint: `${data.words.length} 词`, action: () => setScope(scope, '全部') },
    ...(data.sections || []).map((s) => ({
      label: s.label + (s.topic ? `　${s.topic}` : ''),
      hint: `${countOf(s.label)} 词`,
      action: () => setScope(scope, s.label),
    })),
  ]);
}

function tierBlock(t, list, marks) {
  if (!list.length) return '';
  const isOpen = openTier[t];
  const shown = list.slice(0, limit[t]);

  return `
    <div class="card-head" style="margin-top:var(--s4)">
      <span class="tag ${t === 1 ? 'ink' : t === 2 ? 'brand' : ''}">${TIER[t].name}</span>
      <span class="card-title">${list.length}</span>
      <span class="hint">${TIER[t].desc}</span>
      <button class="btn sm bare" data-tier="${t}" style="margin-left:auto">
        ${isOpen ? '收起' : '展开'}
      </button>
    </div>
    ${isOpen ? `
      <div class="row-list">${shown.map((w) => wordRow(w, marks)).join('')}</div>
      ${list.length > limit[t]
        ? `<button class="btn block" data-more="${t}">
             再显示 ${Math.min(PAGE, list.length - limit[t])} 个（还有 ${list.length - limit[t]}）
           </button>`
        : ''}
    ` : ''}
  `;
}

function wordRow(w, marks) {
  const id = `${w.term}|${w.tier}`;
  const isOpen = expanded.has(id);
  const card = store.findCardByTerm(w.term);
  const m = marks[w.term];
  const dot = m === 'unknown' ? 'var(--bad)' : m === 'shaky' ? 'var(--warn)' : m === 'known' ? 'var(--ok)' : 'var(--line)';

  return `
    <div class="row-item" data-row="${escape(id)}">
      <span class="row-icon" style="color:${dot}">●</span>
      <span class="row-body">
        <span class="row-title">
          ${escape(w.term)}${w.count > 1 ? ` <span class="tag">×${w.count}</span>` : ''}
        </span>
        <span class="row-sub">${w.cn ? escape(w.cn) : '<span class="mute">（词库暂缺释义）</span>'}</span>
        ${isOpen ? `
          ${w.phon ? `<span class="row-sub">/${escape(w.phon)}/　${w.pos ? escape(w.pos) : ''}</span>` : ''}
          ${(w.forms || []).length > 1 ? `<span class="row-sub">文中形态：${w.forms.map(escape).join(' / ')}</span>` : ''}
          ${card && card.sense ? `<span class="row-sub"><b style="color:var(--brand-dark)">本文义</b>　${escape(card.sense)}</span>` : ''}
          ${w.sentence ? `<span class="row-sub" style="font-family:var(--font-en);line-height:1.8">${escape(w.sentence)}</span>` : ''}
          ${w.source ? `<span class="row-sub">—— ${escape(w.source)}</span>` : ''}
          ${card && card.note ? `<span class="row-sub" style="color:var(--warn)">💡 ${escape(card.note)}</span>` : ''}
          <button class="btn block${card ? '' : ' primary'}" data-add="${escape(w.term)}"
            style="margin-top:var(--s2)" ${card ? 'disabled' : ''}>
            ${card ? '✓ 已在生词本里' : '加入生词本'}
          </button>
        ` : ''}
      </span>
      <span class="row-caret">${isOpen ? '⌄' : '›'}</span>
    </div>
  `;
}

function phrasesBlock(phrases) {
  return `
    <div class="section">重点短语 · ${phrases.length}</div>
    <div class="row-list">
      ${phrases.map((p) => `
        <div class="row-item static">
          <span class="row-body">
            <span class="row-title">
              ${escape(p.term)}
              <span class="tag ${p.tier === 1 ? 'ink' : 'brand'}">${p.tier === 1 ? '考点' : '核心'}</span>
              ${p.count > 1 ? `<span class="tag">×${p.count}</span>` : ''}
            </span>
            <span class="row-sub">${(p.sections || []).map(escape).join(' · ')}</span>
            ${p.sentence ? `<span class="row-sub" style="font-family:var(--font-en);line-height:1.8;margin-top:var(--s2)">${escape(p.sentence)}</span>` : ''}
          </span>
        </div>`).join('')}
    </div>
  `;
}

function addFromList(term) {
  const w = data.words.find((x) => x.term === term);
  if (!w) return;
  if (store.findCardByTerm(term)) { toast('已经在了'); return; }
  rememberWord(w, 'shaky');
  toast(`已加入生词本：${term}`);
}

function wireList(root) {
  for (const b of root.querySelectorAll('[data-paper]')) {
    b.onclick = () => switchPaper(root, b.dataset.paper);
  }
  const pick = root.querySelector('[data-scope-pick]');
  if (pick) pick.onclick = openSectionPicker;
  for (const h of root.querySelectorAll('[data-tier]')) {
    h.onclick = () => { const t = h.dataset.tier; openTier[t] = !openTier[t]; renderList(root); };
  }
  for (const b of root.querySelectorAll('[data-more]')) {
    b.onclick = () => { const t = b.dataset.more; limit[t] += PAGE; renderList(root); };
  }
  for (const el of root.querySelectorAll('[data-row]')) {
    el.onclick = () => {
      const id = el.dataset.row;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderList(root);
    };
  }
  for (const b of root.querySelectorAll('[data-add]')) {
    b.onclick = (e) => { e.stopPropagation(); addFromList(b.dataset.add); renderList(root); };
  }
}

/* ------------------------- 键盘（只在刷词卡存在时生效） ------------------------- */

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('drillCard')) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (!drill || drill.done) return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!drill.revealed) { drill.revealed = true; renderDrill(rootEl()); }
    return;
  }
  const map = { 1: 'unknown', 2: 'shaky', 3: 'known' };
  if (map[e.key]) {
    const w = drill.list[drill.i];
    if (w) grade(rootEl(), w, map[e.key]);
  }
});
