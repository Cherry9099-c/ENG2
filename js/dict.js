/**
 * 内置词典
 *
 * 目前用 data/dict.json 里的精简词库。
 * 之后如果网络可用，会用开源的 ECDICT 过滤出「考研大纲 5500 词 + 你卷子里出现的词」，
 * 生成同样格式的文件替换掉，体积可控制在 1MB 以内，手机上加载无压力。
 */

import { lookupForms } from './lemma.js';

let table = null;
let meta = { count: 0, name: '—' };

export async function loadDict() {
  try {
    // 用 no-cache 而不是 force-cache：force-cache 会一直吃旧缓存，
    // 词库更新后浏览器还在用老版本，页面上就一片「词库暂缺释义」。
    const res = await fetch('data/dict.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    table = data.words || {};
    meta = { count: Object.keys(table).length, name: data.meta?.name || '内置词库' };
  } catch (e) {
    console.warn('[dict] 词库载入失败', e);
    table = {};
    meta = { count: 0, name: '未载入' };
  }
  return meta;
}

export function dictMeta() { return meta; }

export function normalize(w) {
  return String(w || '')
    .toLowerCase()
    .replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');
}

/** 查词，返回 { word, phon, pos, cn, tag, base } 或 null */
export function lookup(raw) {
  if (!table) return null;
  const w = normalize(raw);
  if (!w || w.length < 2) return null;

  for (const c of lookupForms(w)) {
    const hit = table[c];
    if (hit) {
      return {
        word: w,
        base: c,
        phon: hit[0] || '',
        pos: hit[1] || '',
        cn: hit[2] || '',
        tag: hit[3] || '',
      };
    }
  }
  return null;
}

export function has(raw) {
  return !!lookup(raw);
}
