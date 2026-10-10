/**
 * 句子结构自动标注
 *
 * 说明白一件事：**真正的句式拆解要人来写**。程序没法判断 "that" 到底是引导定语从句
 * 还是宾语从句，也读不出作者的意图。所以这里做的是**机器能可靠做到的部分**：
 *
 *   · 按标点和从属连词把句子切成语块
 *   · 给每个语块打一个「大概率是什么成分」的标签
 *   · 抽出可能的句子主干，给出括号化
 *
 * 它是给你「先自己划、再对照」用的参考，不是标准答案。真正精准的拆解在「句段」页，
 * 那些是我一句一句手写的。
 */

import { tokenize, escape } from './text.js';

/* ------------------------- 词表 ------------------------- */

const SUB = {
  time:      ['when', 'whenever', 'while', 'before', 'after', 'until', 'till', 'since', 'once'],
  cause:     ['because', 'since', 'as', 'for'],
  condition: ['if', 'unless', 'provided', 'assuming', 'lest'],
  concession:['although', 'though', 'whereas', 'even'],
  purpose:   ['so', 'that'],
};

const RELATIVE = ['that', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why'];
const NOMINAL = ['that', 'whether', 'what', 'whatever', 'whoever', 'whichever', 'how', 'why'];
const COORD = ['and', 'but', 'or', 'nor', 'yet'];

/** 引导词 → 中文标签（尽量说清「它引导什么」而不是只给个术语） */
const REL_NOTE = {
  that: 'that 引导 — 作定语从句时后面跟不完整句子，作宾语从句时 that 本身不作成分',
  which: 'which 引导 — 指代前面的名词或整件事',
  who: 'who 引导 — 修饰人',
  whom: 'whom 引导 — 修饰人，在从句里作宾语',
  whose: 'whose 引导 — 表示所属关系',
  when: 'when 引导 — 前面是时间类名词时是定语从句，否则是时间状语从句',
  where: 'where 引导 — 前面是地点/情况类名词时是定语从句',
  why: 'why 引导 — 前面通常是 reason',
  because: 'because 引导 — 原因状语从句',
  although: 'although 引导 — 让步状语从句',
  though: 'though 引导 — 让步状语从句',
  while: 'while 引导 — 可表「当…时」也可表「虽然」，看语义',
  whereas: 'whereas 引导 — 对比状语从句',
  if: 'if 引导 — 条件状语从句',
  unless: 'unless 引导 — 条件状语从句（除非）',
  since: 'since 引导 — 可表原因也可表时间',
  as: 'as 引导 — 用法很多，看它在从句里作什么成分',
  so: 'so that 引导 — 目的或结果状语从句',
  than: 'than 引导 — 比较状语从句',
  whether: 'whether 引导 — 名词性从句（是否）',
  what: 'what 引导 — 名词性从句，what 本身在从句里作成分',
};

/**
 * 能作为「切分点」的引导词。
 *
 * 比标签用的词表窄——`as` 和 `for` 既能当介词又能当连词
 * （began as an emergency measure），拿它们切会把主干切碎，所以不收。
 */
const CUT_WORDS = new Set([
  'because', 'although', 'though', 'whereas', 'if', 'unless', 'whether',
  'when', 'whenever', 'while', 'until', 'till', 'before', 'after', 'once',
  'that', 'which', 'who', 'whom', 'whose', 'where', 'why',
  'what', 'whatever', 'whoever', 'whichever', 'than',
]);

/* ------------------------- 工具 ------------------------- */

const PREP = new Set(`about above across after against along among around at before behind
below beneath beside between beyond by down during except for from in inside into near of
off on onto out outside over past per since through throughout to toward towards under
until up upon via with within without`.split(/\s+/));

const lower = (s) => String(s).toLowerCase();

/* ------------------------- 主流程 ------------------------- */

/**
 * 切句 + 打标签
 * @returns {{chunks: Array, main: string, bracket: string}}
 */
export function analyzeSentence(text) {
  const toks = tokenize(text).filter((t) => t.type === 'word');
  if (!toks.length) return { chunks: [], main: '', bracket: '' };

  // 记录每个词在原文里的位置，方便按标点切
  const marks = [];   // { word, start, end, lower, gapBefore }
  let prevEnd = 0;
  for (const t of toks) {
    marks.push({
      word: t.text,
      lower: lower(t.text),
      start: t.start,
      end: t.end,
      gapBefore: text.slice(prevEnd, t.start),
    });
    prevEnd = t.end;
  }

  // 切分成语块：从属连词/关系词开头，或标点之后，都算新语块
  const starts = [0];
  for (let i = 1; i < marks.length; i++) {
    const m = marks[i];
    const punctBreak = /[,;:—–]/.test(m.gapBefore);
    if (punctBreak || CUT_WORDS.has(m.lower)) starts.push(i);
  }
  starts.push(marks.length);

  const chunks = [];
  let seenMain = false;
  for (let c = 0; c < starts.length - 1; c++) {
    const a = starts[c];
    const b = starts[c + 1];
    if (b <= a) continue;
    const seg = text.slice(marks[a].start, marks[b - 1].end);
    const chunk = tagChunk(seg, marks.slice(a, b), c === 0, marks, a, b, seenMain);
    chunk.start = marks[a].start;
    chunk.end = marks[b - 1].end;
    if (chunk.kind === 'main' || chunk.kind === 'coord') seenMain = true;
    chunks.push(chunk);
  }

  // 非从句部分：拼的时候把原来的逗号带上，不然读起来像一串词
  const mainChunks = chunks.filter((c) => c.kind === 'main' || c.kind === 'coord');
  let main = '';
  mainChunks.forEach((c, i) => {
    if (i === 0) { main = c.text; return; }
    const gap = text.slice(mainChunks[i - 1].end, c.start);
    main += (/[,;]/.test(gap) ? ', ' : ' ') + c.text;
  });

  // 括号化：在原文上按位置插括号，标点和空格原样保留
  let bracket = '';
  let cursor = 0;
  for (const c of chunks) {
    bracket += text.slice(cursor, c.start);
    const seg = text.slice(c.start, c.end);
    bracket += c.kind === 'main' ? seg : `[${seg}]`;
    cursor = c.end;
  }
  bracket += text.slice(cursor);

  return { chunks, main, bracket: bracket.trim() };
}

/** 给一个语块打标签 */
function tagChunk(seg, toks, isFirst, allMarks, a, b, seenMain) {
  const text = seg.trim();
  const first = toks[0].lower;
  const second = toks[1] ? toks[1].lower : '';

  // 第二个词是助动词/be 动词，说明这是个有主谓结构的句子，不是插入语
  const looksLikeClause = !!second && (AUX.has(second) || isVerbLike(second));

  const base = isFirst
    ? { text, kind: 'main', tag: '主句', note: '' }
    : (!seenMain && looksLikeClause)
      ? { text, kind: 'main', tag: '主句', note: '从句之后的谓语部分，很可能是主句' }
      // 不是以任何已知标记开头的后续语块，不敢断言是主句——它可能是同位语、
      // 并列分句、或者只是主句被逗号断开的后半截。
      : {
          text, kind: 'main', tag: '其余部分',
          note: '不是以从句引导词或非谓语开头，可能是同位语 / 并列分句 / 主句的延续',
        };

  // to 开头：可能是不定式也可能是介词短语（to Microsoft critics / to become a doctor）。
  // 程序分不清 to 后面那个词是动词还是名词，所以不硬猜，把判断方法写出来。
  if (first === 'to' && second) {
    return {
      text, kind: 'phrase', tag: 'to 结构',
      note: 'to 后面是动词原形 → 不定式；是名词/动名词 → 介词短语。看 to 后那个词',
    };
  }
  if (/ing$/.test(first) && first.length > 4) {
    return { text, kind: 'phrase', tag: '现在分词', note: 'doing 结构，作状语或后置定语，逻辑主语通常与主句主语一致' };
  }
  if (/ed$/.test(first) && first.length > 4) {
    return { text, kind: 'phrase', tag: '过去分词', note: 'done 结构，多表示被动或完成，作状语或后置定语' };
  }

  // 介词短语
  if (PREP.has(first)) {
    return { text, kind: 'phrase', tag: '介词短语', note: '作状语（时间/地点/方式）或后置定语' };
  }

  // 从属连词引导的状语从句
  for (const [type, list] of Object.entries(SUB)) {
    if (list.includes(first)) {
      if (first === 'that' || (first === 'so' && second !== 'that')) break;
      const label = { time: '时间状语从句', cause: '原因状语从句', condition: '条件状语从句',
        concession: '让步状语从句', purpose: '目的/结果状语从句' }[type];
      return { text, kind: 'clause', tag: label, note: REL_NOTE[first] || '' };
    }
  }
  if (first === 'so' && second === 'that') {
    return { text, kind: 'clause', tag: '目的/结果状语从句', note: 'so that 后面跟目的或结果' };
  }
  if (first === 'than') {
    return { text, kind: 'clause', tag: '比较状语从句', note: 'than 后面常出现替代现象（did / does 代替前面的动词）' };
  }

  // 关系词开头 → 从句
  if (RELATIVE.includes(first) || NOMINAL.includes(first)) {
    const prevLower = a > 0 ? allMarks[a - 1].lower : '';
    const gap = toks[0].gapBefore;
    const next = second;

    // 怎么区分定语从句和名词性从句：看引导词**后面**那个词。
    //   that the boundary …  → 后面是限定词，说明从句自带主语 → 名词性从句
    //   that lie in their path → 后面直接是动词，说明 that 自己作主语 → 定语从句
    // 之前是反过来看前面的词，结果 "companies that lie…" 因为 companies 以 s 结尾
    // 被 isVerbLike 判成了动词，一路错成宾语从句。
    if (REPORT_VERBS.has(prevLower)) {
      return { text, kind: 'clause', tag: '宾语从句', note: '引导词跟在 reporting verb 之后' };
    }
    if (DETERMINERS.has(next)) {
      return { text, kind: 'clause', tag: '名词性从句', note: REL_NOTE[first] || '' };
    }
    if (next && !RELATIVE.includes(next)) {
      return {
        text, kind: 'clause', tag: '定语从句',
        note: `${REL_NOTE[first] || ''}（引导词后面直接跟动词，说明它在从句里作主语）`,
      };
    }
    if (gap && /[,;:—–]/.test(gap)) {
      return { text, kind: 'clause', tag: '非限定从句?', note: '前面有逗号，多半是补充说明，拿掉不影响句子完整' };
    }
    return { text, kind: 'clause', tag: '从句', note: REL_NOTE[first] || '' };
  }

  // 并列分句
  if (COORD.includes(first)) {
    return { text, kind: 'coord', tag: '并列成分', note: `${first} 连接的并列部分` };
  }

  // 插入语：被标点夹住、很短、又不是句子开头，而且**没有主谓结构**。
  // 最后一条是关键——不然「it is still feasible」这种正牌主句也会被当成插入语。
  if (!isFirst && toks.length <= 4 && !looksLikeClause && /[,;:—–]/.test(toks[0].gapBefore)) {
    return { text, kind: 'paren', tag: '插入语?', note: '拿掉它句子仍然完整 → 大概率是插入成分' };
  }

  return base;
}

/** 助动词 / be 动词：用来判断一个语块有没有主谓结构 */
const AUX = new Set(['is', 'are', 'was', 'were', 'am', 'be', 'been', 'being',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'may', 'might', 'must', 'should', 'shall']);

/** 限定词：从句引导词后面接限定词，说明从句自带主语 */
const DETERMINERS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'some', 'any', 'no',
  'every', 'each', 'all', 'both', 'most', 'many', 'much', 'few', 'several']);

/** 能带宾语从句的动词 */
const REPORT_VERBS = new Set(['say', 'says', 'said', 'think', 'thinks', 'thought',
  'find', 'finds', 'found', 'show', 'shows', 'showed', 'shown', 'suggest', 'suggests',
  'suggested', 'argue', 'argues', 'argued', 'believe', 'believes', 'believed',
  'know', 'knows', 'knew', 'known', 'report', 'reports', 'reported', 'note', 'notes',
  'noted', 'claim', 'claims', 'claimed', 'warn', 'warns', 'warned', 'admit', 'admits',
  'admitted', 'reveal', 'reveals', 'revealed', 'indicate', 'indicates', 'indicated',
  'conclude', 'concludes', 'concluded', 'confirm', 'confirms', 'confirmed',
  'assume', 'assumes', 'assumed', 'realize', 'realizes', 'realized', 'hear', 'heard']);

/** 粗判一个词像不像动词（用来区分 that 引导的是宾语从句还是定语从句） */
function isVerbLike(w) {
  if (!w) return false;
  return /(?:s|ed|ing)$/.test(w) || ['say', 'said', 'think', 'thought', 'find', 'found',
    'show', 'showed', 'suggest', 'argue', 'believe', 'know', 'knew', 'report', 'note',
    'claim', 'warn', 'admit', 'reveal', 'mean', 'means', 'indicate', 'conclude'].includes(w);
}

/* ------------------------- 渲染 ------------------------- */

const KIND_CLASS = {
  main: 'k-main', coord: 'k-coord', clause: 'k-clause', phrase: 'k-phrase', paren: 'k-paren',
};

/** 生成标注结果的 HTML */
export function renderAnalysis(res) {
  if (!res.chunks.length) return '';
  const mainHtml = res.main
    ? `<div class="kv"><b>非从句</b><div>${escape(res.main)}<br>
         <span class="mute">（把标成从句的块拿掉之后剩下的，可能就是主干）</span></div></div>`
    : `<div class="kv"><b>非从句</b><div class="mute">
         没剩下什么 —— 说明这一句的切分可能不准，自己划一遍更靠谱。</div></div>`;

  return `
    <div>
      ${res.chunks.map((c) => `
        <div class="parse-chunk">
          <span class="pc-tag ${KIND_CLASS[c.kind] || ''}">${escape(c.tag)}</span>
          <div class="pc-body">
            <div class="pc-text">${escape(c.text)}</div>
            ${c.note ? `<div class="pc-note">${escape(c.note)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>
    ${mainHtml}
    ${res.bracket ? `<div class="kv"><b>括号化</b><div class="bracket">${escape(res.bracket)}</div></div>` : ''}
    <div class="hint" style="margin-top:var(--s3)">
      机器只按标点和引导词切分，判断不了 that / when 这类词的具体用法，
      也找不出真正的谓语。先自己划一遍再对照，别直接背这个结果。
    </div>
  `;
}
