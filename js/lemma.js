/**
 * 词形处理
 *
 * 两个用途：
 *   lookupForms(word)  查词典时按「原形 → 逐步剥离词缀」的顺序尝试
 *   stemKey(word)      提取生词时把 undermine/undermines/undermined/undermining 归成一类
 *
 * 这是规则方法，不依赖任何外部词库，因此离线也能用。
 * 规则覆盖不了的不规则变化（give→given、analysis→analyses）会归不到一起，
 * 属于已知限制，人工合并即可。
 */

/**
 * 不规则动词/形容词变化表。
 *
 * 规则词干法处理不了 laid→lay、risen→rise、sought→seek 这类，
 * 没有这张表，阅读器里点 "laid" 查不到 "lay"，词表里也会把它们当成生词。
 */
const IRREGULAR = {
  laid: 'lay', lain: 'lie', lay: 'lie', paid: 'pay', said: 'say', made: 'make',
  had: 'have', went: 'go', gone: 'go', did: 'do', done: 'do', been: 'be',
  was: 'be', were: 'be', am: 'be', is: 'be', are: 'be',
  took: 'take', taken: 'take', gave: 'give', given: 'give', saw: 'see', seen: 'see',
  came: 'come', knew: 'know', known: 'know', grew: 'grow', grown: 'grow',
  drew: 'draw', drawn: 'draw', flew: 'fly', flown: 'fly', threw: 'throw', thrown: 'throw',
  blew: 'blow', blown: 'blow', wrote: 'write', written: 'write', spoke: 'speak', spoken: 'speak',
  broke: 'break', broken: 'break', chose: 'choose', chosen: 'choose',
  drove: 'drive', driven: 'drive', rode: 'ride', ridden: 'ride',
  rose: 'rise', risen: 'rise', ate: 'eat', eaten: 'eat', fell: 'fall', fallen: 'fall',
  forgot: 'forget', forgotten: 'forget', began: 'begin', begun: 'begin',
  sang: 'sing', sung: 'sing', swam: 'swim', swum: 'swim', rang: 'ring', rung: 'ring',
  drank: 'drink', drunk: 'drink', wore: 'wear', worn: 'wear', tore: 'tear', torn: 'tear',
  woke: 'wake', woken: 'wake', stole: 'steal', stolen: 'steal',
  shook: 'shake', shaken: 'shake', shone: 'shine', shot: 'shoot',
  sought: 'seek', bought: 'buy', brought: 'bring', thought: 'think', caught: 'catch',
  taught: 'teach', fought: 'fight', found: 'find', held: 'hold', kept: 'keep',
  left: 'leave', lent: 'lend', lost: 'lose', meant: 'mean', met: 'meet',
  sent: 'send', spent: 'spend', built: 'build', felt: 'feel', told: 'tell',
  sold: 'sell', stood: 'stand', understood: 'understand', won: 'win', sat: 'sit',
  ran: 'run', became: 'become', got: 'get', gotten: 'get',
  struck: 'strike', stuck: 'stick', swept: 'sweep', swore: 'swear', sworn: 'swear',
  hid: 'hide', hidden: 'hide', lit: 'light', dealt: 'deal', dug: 'dig',
  shut: 'shut', slept: 'sleep', fed: 'feed', fled: 'flee', bred: 'breed',
  bound: 'bind', hung: 'hang', arose: 'arise', arisen: 'arise',
  arose: 'arise', undertook: 'undertake', underwent: 'undergo', overcame: 'overcome',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  mice: 'mouse', geese: 'goose', criteria: 'criterion', phenomena: 'phenomenon',
  analyses: 'analysis', crises: 'crisis', theses: 'thesis', hypotheses: 'hypothesis',
  data: 'datum', media: 'medium', formulae: 'formula', indices: 'index',
  // 美式拼写 → 英式（OALD 收的是英式词头）
  cozy: 'cosy', color: 'colour', favor: 'favour', labor: 'labour',
  organize: 'organise', analyze: 'analyse', minimize: 'minimise',
  characterize: 'characterise', emphasize: 'emphasise', realize: 'realise',
  behavior: 'behaviour', behaviors: 'behaviour',
  councilor: 'councillor', councilors: 'councillor',
  counselor: 'counsellor', counselors: 'counsellor',
  defense: 'defence', offense: 'offence', license: 'licence',
  center: 'centre', theater: 'theatre', meter: 'metre', liter: 'litre',
  traveler: 'traveller', traveled: 'travel', traveling: 'travel',
  canceled: 'cancel', canceling: 'cancel', modeled: 'model', modeling: 'model',

  // 补几个漏掉的不规则形式与派生词
  heard: 'hear', shown: 'show', showed: 'show',
  underlying: 'underlie', underwent: 'undergo', undertaken: 'undertake',
  arisen: 'arise', borne: 'bear', borne2: 'bear', beaten: 'beat',
  bitten: 'bite', blown: 'blow', chosen: 'choose', driven: 'drive',
  forbidden: 'forbid', forgiven: 'forgive', frozen: 'freeze',
  gotten: 'get', hidden: 'hide', proven: 'prove', ridden: 'ride',
  risen: 'rise', shaken: 'shake', stolen: 'steal', sworn: 'swear',
  torn: 'tear', worn: 'wear', woven: 'weave', written: 'write',
};

/** 查词顺序：先试原词，再试不规则表，再逐步尝试规则还原形式 */
export function lookupForms(word) {
  const w = String(word || '').toLowerCase().replace(/^[^a-z'-]+|[^a-z'-]+$/g, '');
  const out = [w];
  const push = (s) => { if (s && s.length > 1 && !out.includes(s)) out.push(s); };

  if (IRREGULAR[w]) push(IRREGULAR[w]);

  if (w.endsWith('ies')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('ied')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('es')) push(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) push(w.slice(0, -1));
  if (w.endsWith('ed')) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
  if (w.endsWith('ing')) { push(w.slice(0, -3)); push(w.slice(0, -3) + 'e'); }
  if (w.endsWith('ly')) push(w.slice(0, -2));
  if (w.endsWith('iest')) push(w.slice(0, -4) + 'y');
  if (w.endsWith('ier')) push(w.slice(0, -3) + 'y');
  if (w.endsWith('est')) push(w.slice(0, -3));
  if (w.endsWith('er')) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
  // 去重复辅音：running → run、biggest → big（-est/-er 结尾的也要处理，
  // 否则 biggest 会被还原成 bigg）
  if (/([bdfgklmnprt])\1(ed|ing|est|er)$/.test(w)) {
    push(w.replace(/([bdfgklmnprt])\1(ed|ing|est|er)$/, '$1'));
  }

  return out;
}

/**
 * 归类用的粗词干，反复剥离直到稳定。
 *
 * 只剥一层不够：feelings → feeling → feel，objectively → objective → objectiv。
 * 剥不干净会让同一族词被拆成好几个候选，也让基础词表过滤失效。
 *
 * 几个刻意的取舍：
 *   - 词尾 ss 不剥（class / business 不能被砍成 clas / busines）
 *   - 剥完短于 3 个字母就回退
 *   - 统一去掉词尾 e，让 undermine / undermines 归到一起
 */
export function stemKey(word) {
  const raw = String(word || '').toLowerCase();
  // 不规则变化先归一：laid / risen / sought 要归到 lay / rise / seek
  if (IRREGULAR[raw]) word = IRREGULAR[raw];

  let s = String(word || '').toLowerCase();
  if (s.length < 4) return s;

  for (let pass = 0; pass < 3; pass++) {
    const before = s;
    let t = s.replace(/(ies|ied)$/, 'y');

    // 记录这一趟剥掉的是什么后缀：只有 -ing/-ed/-er/-est 才可能造成辅音重复
    // （running → runn），-s/-es/-ly 不会。否则 skills 会被砍成 skil。
    let stripped = '';
    const m = /(ing|edly|ed|ly|est|er)$/.exec(t);
    if (m) { stripped = m[1]; t = t.slice(0, -stripped.length); }
    if (t.length >= 3) {
      const es = /(?<!s)es$/.exec(t);
      if (es) { t = t.slice(0, -2); stripped = 'es'; }
      else if (/(?<!s)s$/.test(t)) { t = t.slice(0, -1); stripped = 's'; }
    }
    if (t.length < 3) break;

    t = t.replace(/e$/, '');
    if (/^(ing|ed|er|est)$/.test(stripped)) t = t.replace(/([bdfgklmnprt])\1$/, '$1');
    if (t.length < 3) break;

    s = t;
    if (s === before) break;
  }
  return s;
}

/**
 * 从一组观察到的表面形式里挑出最适合当词条的形态。
 *
 * 优先顺序：
 *   1. 观察到的形式本身就在词库里 → 直接用（employee 在词库就成了 employee）
 *   2. 还原后的形式在词库里 → 用它（employees → employee）
 *   3. 兜底：观察到的形式里最短的那个（undermine 比 undermines 短）
 *
 * 规则方法无法解决全部歧义（causes 既可能是 cause+s 也可能是 caus+es），
 * 所以这只是「建议词条」，最终以人工填写的 term 为准。
 */
export function baseForm(surfaceForms, dictSet) {
  const list = [...surfaceForms];
  if (!list.length) return '';

  if (dictSet) {
    for (const f of list) if (dictSet.has(f)) return f;
    for (const f of list) {
      for (const c of lookupForms(f)) if (dictSet.has(c)) return c;
    }
  }

  return list.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}
