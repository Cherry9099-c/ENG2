/**
 * 本地数据仓库
 *
 * 内容（卡片、长难句）来自 data/*.json + 用户在阅读器里新增的条目；
 * 学习进度、标记、日志全部存在浏览器 localStorage 里，不上传任何服务器。
 */

import { schedule, stageOf, isDue } from './srs.js';

const KEY = {
  progress:  'ey2:progress:v1',
  cards:     'ey2:cards:v1',
  sentences: 'ey2:sentences:v1',
  marked:    'ey2:marked:v1',
  log:       'ey2:log:v1',
  drill:     'ey2:drill:v1',
};

/* 说明：原本还有一套设置（每天新词上限 / 单次复习上限 / 排序 / 显示音标），
   只有已删除的复习页在用；现在没有任何地方读它，所以整套去掉了。 */

export const state = {
  ready: false,
  baseCards: [],
  baseSentences: [],
  basePassages: [],
  userCards: [],
  userSentences: [],
  progress: {},
  marked: {},
  log: {},
  drill: {},
  loadError: null,
};

/* ------------------------- 底层读写 ------------------------- */

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.warn('[store] 读取失败', key, e);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('[store] 保存失败（可能是浏览器隐私模式或空间已满）', key, e);
    return false;
  }
}

async function fetchJSON(url, fallback) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[store] 载入数据文件失败', url, e);
    return fallback;
  }
}

export function uid(prefix = 'u') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------- 初始化 ------------------------- */

export async function init() {
  // 内容按卷子分文件存放，data/index.json 列出所有文件；
  // 没有 index.json 时退回单文件，保证旧数据也能用。
  const index = await fetchJSON('data/index.json', null);
  const cardFiles = (index && Array.isArray(index.cards) && index.cards.length)
    ? index.cards : ['data/cards.json'];
  const sentFiles = (index && Array.isArray(index.sentences) && index.sentences.length)
    ? index.sentences : ['data/sentences.json'];
  const passFiles = (index && Array.isArray(index.passages)) ? index.passages : [];

  const [cardDocs, sentDocs, passDocs] = await Promise.all([
    Promise.all(cardFiles.map((f) => fetchJSON(f, { cards: [] }))),
    Promise.all(sentFiles.map((f) => fetchJSON(f, { sentences: [] }))),
    Promise.all(passFiles.map((f) => fetchJSON(f, { passages: [] }))),
  ]);

  state.baseCards = cardDocs.flatMap((d) => (Array.isArray(d?.cards) ? d.cards : []));
  state.baseSentences = sentDocs.flatMap((d) => (Array.isArray(d?.sentences) ? d.sentences : []));
  state.basePassages = passDocs.flatMap((d) => (Array.isArray(d?.passages) ? d.passages : []));
  state.userCards = read(KEY.cards, []);
  state.userSentences = read(KEY.sentences, []);
  state.progress = read(KEY.progress, {});
  state.marked = read(KEY.marked, {});
  state.log = read(KEY.log, {});
  state.drill = read(KEY.drill, {});
  state.ready = true;

  if (!state.baseCards.length) {
    console.warn('[store] 没有载入任何卡片，检查 data/index.json 里的路径');
  }
  return state;
}

/* ------------------------- 卡片 ------------------------- */

export function allCards() {
  const seen = new Set();
  const out = [];
  for (const c of [...state.baseCards, ...state.userCards]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** 是否已经有同一个词条（用于阅读器避免重复添加） */
export function findCardByTerm(term) {
  const t = String(term).trim().toLowerCase();
  return allCards().find((c) => String(c.term || c.front || '').trim().toLowerCase() === t) || null;
}

export function addUserCard(card) {
  const existing = findCardByTerm(card.term || card.front);
  if (existing) return existing;
  const full = {
    id: card.id || uid('u'),
    type: card.type || 'word',
    ...card,
    created: Date.now(),
    source: card.source || '手动添加',
  };
  state.userCards.push(full);
  write(KEY.cards, state.userCards);
  return full;
}

/* 说明：这里原本还有 removeUserCard() 和 todayQueue()。
   todayQueue 是给复习页排「今日待办」的，复习页去掉后没人调；
   removeUserCard 也只有复习页的删除按钮用过。都已删除。
   统计页要的「到期待复习」仍在 stats() 里用 isDue() 算。 */

/* ------------------------- 复习记录 ------------------------- */

export function recordReview(cardId, quality, now = Date.now()) {
  const prev = state.progress[cardId];
  const wasNew = !prev || !prev.reps;
  const next = schedule(prev, quality, now);
  state.progress[cardId] = next;
  write(KEY.progress, state.progress);

  const d = dayKey(now);
  if (!state.log[d]) state.log[d] = { reviewed: 0, newLearned: 0, again: 0, good: 0 };
  const L = state.log[d];
  L.reviewed += 1;
  if (wasNew && quality >= 3) L.newLearned += 1;
  if (quality < 3) L.again += 1; else L.good += 1;
  write(KEY.log, state.log);

  return next;
}

/**
 * 清空学习进度。刷词标记也要一起清——
 * 界面上的确认框写的是「刷词标记和打分记录归零」，
 * 只清 progress/log 的话那句话就是假的（统计页的「待巩固」不会动）。
 */
export function resetProgress() {
  state.progress = {};
  state.log = {};
  state.drill = {};
  write(KEY.progress, state.progress);
  write(KEY.log, state.log);
  write(KEY.drill, state.drill);
}

/* ------------------------- 长难句 ------------------------- */

export function allSentences() {
  const seen = new Set();
  const out = [];
  for (const s of [...state.baseSentences, ...state.userSentences]) {
    if (!s || !s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function addUserSentence(sent) {
  const full = { id: sent.id || uid('s'), ...sent, created: Date.now(), source: sent.source || '手动添加' };
  state.userSentences.push(full);
  write(KEY.sentences, state.userSentences);
  return full;
}

/* ------------------------- 刷词状态 ------------------------- */

/**
 * 刷单词的进度：{ 卷子: { 词: 'unknown' | 'shaky' | 'known' } }
 * 和 SM-2 复习进度分开存——刷词是「过一遍分个类」，不参与间隔重复排程。
 */
export function drillGet(paper) {
  return state.drill[paper] || {};
}

export function drillMark(paper, term, level) {
  if (!state.drill[paper]) state.drill[paper] = {};
  state.drill[paper][term] = level;
  write(KEY.drill, state.drill);
}

export function drillReset(paper) {
  if (paper) delete state.drill[paper];
  else state.drill = {};
  write(KEY.drill, state.drill);
}

export function drillStats(paper) {
  const d = drillGet(paper);
  const out = { unknown: 0, shaky: 0, known: 0, total: 0 };
  for (const v of Object.values(d)) {
    if (out[v] === undefined) continue;
    out[v] += 1;
    out.total += 1;
  }
  return out;
}

/**
 * 所有卷子合起来的刷词计数。
 * 同一个词在不同卷子上各算一次——标记本来就是「按卷」的，合并自然会重复。
 */
export function drillAllStats() {
  const out = { unknown: 0, shaky: 0, known: 0, total: 0 };
  for (const paper of Object.values(state.drill)) {
    for (const v of Object.values(paper)) {
      if (out[v] === undefined) continue;
      out[v] += 1;
      out.total += 1;
    }
  }
  return out;
}

/* ------------------------- 段落结构 ------------------------- */

export function allPassages() {
  return Array.isArray(state.basePassages) ? state.basePassages : [];
}

/* ------------------------- 当前卷子 ------------------------- */

/**
 * 「当前卷子」是跨页面共享的状态：在卷子页换了卷，词表和句式两页也应该跟着换。
 * 存在 localStorage 里，下次打开还停在上一张卷子。
 */
export function getPaper() {
  return read('ey2:paper:v1', '') || '';
}

export function setPaper(k) {
  if (k) write('ey2:paper:v1', k);
}

/* ------------------------- 阅读器标记 ------------------------- */

export function isMarked(word) { return !!state.marked[normalizeKey(word)]; }

function normalizeKey(w) { return String(w).trim().toLowerCase(); }

export function markWord(word, on = true) {
  const k = normalizeKey(word);
  if (on) state.marked[k] = true; else delete state.marked[k];
  write(KEY.marked, state.marked);
}

export function markedList() { return Object.keys(state.marked); }

export function articleSave(title, text) {
  try {
    localStorage.setItem('ey2:article:v1', JSON.stringify({ title, text, t: Date.now() }));
  } catch (e) { /* 忽略 */ }
}

export function articleLoad() {
  return read('ey2:article:v1', null);
}

/* ------------------------- 统计 ------------------------- */

export function stats(now = Date.now()) {
  const cards = allCards();
  const counts = { new: 0, learning: 0, young: 0, mature: 0 };
  let dueToday = 0;

  for (const c of cards) {
    const p = state.progress[c.id];
    counts[stageOf(p)] += 1;
    if (isDue(p, now)) dueToday += 1;
  }

  // 连续打卡天数
  let streak = 0;
  const d = new Date(now);
  for (let i = 0; i < 400; i++) {
    const k = dayKey(d.getTime());
    const l = state.log[k];
    if (l && l.reviewed > 0) streak++;
    else if (i > 0) break;
    else if (!l || l.reviewed === 0) { /* 今天还没学，继续看昨天 */ }
    d.setDate(d.getDate() - 1);
  }

  // 最近 35 天热力图（老 → 新）
  const heat = [];
  const h = new Date(now);
  h.setDate(h.getDate() - 34);
  for (let i = 0; i < 35; i++) {
    const k = dayKey(h.getTime());
    heat.push({ day: k, n: (state.log[k]?.reviewed) || 0 });
    h.setDate(h.getDate() + 1);
  }

  const totalReviewed = Object.values(state.log).reduce((s, l) => s + (l.reviewed || 0), 0);
  const totalAgain = Object.values(state.log).reduce((s, l) => s + (l.again || 0), 0);

  // 最常忘的词
  const hard = cards
    .map((c) => ({ card: c, p: state.progress[c.id] }))
    .filter((x) => x.p && (x.p.again || 0) > 0)
    .sort((a, b) => (b.p.again - a.p.again) || (b.p.lapses - a.p.lapses))
    .slice(0, 12);

  return { total: cards.length, counts, dueToday, streak, heat, totalReviewed, totalAgain, hard };
}

/* ------------------------- 备份 ------------------------- */

/**
 * 导出全部学习记录。
 *
 * `drill` 一定要带上——刷词是主功能，早先漏了它，
 * 结果换设备导入备份后「不认识 / 不熟」的标记全没了。
 */
export function exportAll() {
  return JSON.stringify({
    v: 2,
    exportedAt: new Date().toISOString(),
    progress: state.progress,
    drill: state.drill,
    userCards: state.userCards,
    userSentences: state.userSentences,
    marked: state.marked,
    log: state.log,
  }, null, 2);
}

export function importAll(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data.progress) { state.progress = data.progress; write(KEY.progress, state.progress); }
  if (data.drill) { state.drill = data.drill; write(KEY.drill, state.drill); }
  if (data.userCards) { state.userCards = data.userCards; write(KEY.cards, state.userCards); }
  if (data.userSentences) { state.userSentences = data.userSentences; write(KEY.sentences, state.userSentences); }
  if (data.marked) { state.marked = data.marked; write(KEY.marked, state.marked); }
  if (data.log) { state.log = data.log; write(KEY.log, state.log); }
  return true;
}

export { stageOf, isDue };
