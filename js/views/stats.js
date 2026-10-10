/** 统计与数据管理 */

import * as store from '../store.js';
import * as dict from '../dict.js';
import { toast, confirmBox } from '../ui.js';
import { escape } from '../text.js';

let paperIndex = null;

async function loadPapers() {
  if (paperIndex) return paperIndex;
  try {
    const r = await fetch('data/wordlists/index.json', { cache: 'no-cache' });
    paperIndex = (await r.json()).wordlists || [];
  } catch (e) {
    paperIndex = [];
  }
  return paperIndex;
}

/** 单张卷子的掌握情况：一条三段式进度 + 一行数字 */
function paperRow(paper) {
  const total = (paper.stats && paper.stats.total) || 0;
  const st = store.drillStats(paper.key);
  const w = (n) => (total ? +((n / total) * 100).toFixed(1) : 0);
  const donePct = total ? Math.round((st.total / total) * 100) : 0;

  return `
    <div class="stage">
      <div class="stage-top">
        <span>${escape(paper.label)}</span>
        <span class="mono">${st.total} / ${total}</span>
      </div>
      <div class="bar stacked">
        <i class="ok" style="width:${w(st.known)}%"></i>
        <i class="warn" style="width:${w(st.shaky)}%"></i>
        <i class="bad" style="width:${w(st.unknown)}%"></i>
      </div>
      <div class="hint" style="margin-top:var(--s1)">
        已刷 ${donePct}% · 认识 ${st.known} · 不熟 ${st.shaky} · 不认识 ${st.unknown}
        ${total > st.total ? ` · 剩 ${total - st.total} 词没刷` : (total ? ' · 整卷刷完了' : '')}
      </div>
    </div>`;
}

async function renderView(root) {
  const s = store.stats();
  const d = store.drillAllStats();
  const papers = await loadPapers();
  const maxHeat = Math.max(1, ...s.heat.map((h) => h.n));
  const meta = dict.dictMeta();

  const stageRow = (label, n, color) => {
    const pct = s.total ? Math.round((n / s.total) * 100) : 0;
    return `
      <div class="stage">
        <div class="stage-top">
          <span>${label}</span>
          <span class="mono">${n}</span>
        </div>
        <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
      </div>`;
  };

  root.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><b>${s.total}</b><span>生词本条数</span></div>
      <div class="stat"><b style="color:var(--ok)">${s.counts.mature}</b><span>已掌握（≥21 天）</span></div>
      <div class="stat">
        <b style="color:var(--bad)">${d.unknown + d.shaky}</b>
        <span>待巩固（不认识 + 不熟）</span>
      </div>
      <div class="stat"><b style="color:var(--brand)">${s.streak}</b><span>连续学习天数</span></div>
    </div>

    ${papers.length ? `
      <div class="section">各卷掌握程度</div>
      <div class="card">
        ${papers.map(paperRow).join('')}
        <div class="hint" style="margin-top:var(--s3)">
          进度条按你的标记分三段：<span style="color:var(--ok)">认识</span> /
          <span style="color:var(--warn)">不熟</span> /
          <span style="color:var(--bad)">不认识</span>，灰底是还没刷的部分。
        </div>
      </div>
    ` : ''}

    <div class="section">刷词标记（三卷合计）</div>
    <div class="card">
      ${stageRow('认识', d.known, 'var(--ok)')}
      ${stageRow('不熟', d.shaky, 'var(--warn)')}
      ${stageRow('不认识', d.unknown, 'var(--bad)')}
      <div class="hint" style="margin-top:var(--s3)">
        合计标记 ${d.total} 个（同一个词在不同卷上各算一次）
      </div>
    </div>

    <div class="section">掌握程度分布</div>
    <div class="card">
      ${stageRow('已掌握 · 间隔 21 天以上', s.counts.mature, 'var(--ok)')}
      ${stageRow('巩固中 · 1~20 天', s.counts.young, 'var(--brand)')}
      ${stageRow('学习中 · 1 天以内', s.counts.learning, 'var(--warn)')}
      ${stageRow('未标记', s.counts.new, 'var(--ink-3)')}
      <div class="hint" style="margin-top:var(--s3)">
        按你在刷词时的打分推算，越靠上说明记得越牢。
      </div>
    </div>

    <div class="section">最近 35 天</div>
    <div class="card">
      <div class="heat">
        ${s.heat.map((h) => {
          const lvl = h.n === 0 ? ''
            : h.n >= maxHeat * 0.75 ? 'l4'
            : h.n >= maxHeat * 0.5 ? 'l3'
            : h.n >= maxHeat * 0.25 ? 'l2' : 'l1';
          return `<i class="${lvl}" title="${h.day}：${h.n} 张"></i>`;
        }).join('')}
      </div>
      <div class="hint" style="margin-top:var(--s3)">
        累计打分 ${s.totalReviewed} 次 · 其中「不认识」${s.totalAgain} 次
      </div>
    </div>

    <div class="section">最容易忘的词</div>
    <div class="card">
      ${s.hard.length
        ? s.hard.map((x) => `
            <div class="rank">
              <b>${escape(x.card.term || x.card.front || '')}</b>
              <span class="mute" style="font-size:var(--fs-xs)">${escape((x.card.cn || '').slice(0, 12))}</span>
              <span class="n">忘 ${x.p.again} 次</span>
            </div>`).join('')
        : '<div class="hint">还没有数据，先去刷几轮。</div>'}
    </div>

    <div class="section">内置词库</div>
    <div class="card">
      <div class="hint" style="line-height:1.9">
        ${escape(meta.name)} · ${meta.count} 个词条<br>
        释义覆盖三张卷子上出现的全部单词。换手机或换浏览器时，
        用右上角「⋯」里的导出 / 导入搬学习记录。
      </div>
    </div>

    <input type="file" id="impFile" accept=".json,application/json" class="hidden">
  `;

  const fileInput = root.querySelector('#impFile');
  fileInput.onchange = () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        store.importAll(String(reader.result));
        toast('导入成功');
        renderView(root);
      } catch (e) {
        toast('文件格式不对');
      }
    };
    reader.readAsText(f);
  };
}

async function exportBackup() {
  const json = store.exportAll();
  const name = `英二备份-${store.dayKey()}.json`;
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('备份已导出');
  } catch (e) {
    try {
      await navigator.clipboard.writeText(json);
      toast('已复制备份内容到剪贴板');
    } catch (e2) {
      toast('导出失败，请改用电脑打开');
    }
  }
}

function importBackup() {
  const input = document.getElementById('impFile');
  if (input) input.click();
  else toast('请先回到统计页再导入');
}

async function resetAll() {
  const yes = await confirmBox(
    '确定要清空全部学习进度吗？<br><span class="mute">词条本身不会丢，只是刷词标记和打分记录归零。</span>',
    { ok: '清空' }
  );
  if (!yes) return;
  store.resetProgress();
  toast('已清空');
  const root = document.getElementById('view');
  if (root) renderView(root);
}

/** 右上角「⋯」：数据管理不该占着页面 */
function menu() {
  return [
    { label: '导出备份', hint: '下载一份学习记录 JSON', action: exportBackup },
    { label: '导入备份', action: importBackup },
    { label: '清空全部学习进度', danger: true, action: resetAll },
  ];
}

export default { title: '统计', render: renderView, menu };
