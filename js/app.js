/** 应用外壳：启动、路由、标签栏、右上角「⋯」菜单 */

import * as store from './store.js';
import * as dict from './dict.js';
import { initUI, closeSheet, go, openMenu, openSheet } from './ui.js';
import { escape } from './text.js';

import papersView from './views/papers.js';
import { drillView, listView } from './views/wordlist.js';
import sentencesView from './views/sentences.js';
import readerView from './views/reader.js';
import statsView from './views/stats.js';

const routes = {
  papers:    papersView,     // 一级：选卷子、选文章
  drill:     drillView,      // 二级：刷单词（从卷子进入，专注模式）
  sentences: sentencesView,  // 一级：句式拆解
  wordlist:  listView,       // 一级：完整词表
  reader:    readerView,     // 一级：阅读
  stats:     statsView,      // 一级：统计
};

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  // 默认落在「卷子」——一级界面
  return { name: name || 'papers', arg: rest.join('/') };
}

let rendering = false;
let pending = false;

export async function renderRoute() {
  if (rendering) { pending = true; return; }
  rendering = true;
  try {
    const { name, arg } = parseHash();
    const view = routes[name] || routes.papers;

    // 刷单词是专注模式：藏掉标签栏，避免刷到一半跳走
    document.body.classList.toggle('focus-mode', !!view.focus);
    document.getElementById('pageTitle').textContent = view.title || '';
    document.getElementById('backBtn').classList.toggle('hidden', !view.focus);
    document.getElementById('topRight').innerHTML = '';

    const root = document.getElementById('view');
    root.innerHTML = '';
    window.scrollTo(0, 0);

    await view.render(root, arg);

    // 右上角「⋯」：视图自己声明的次要操作。
    // 页面上只留一个主操作，其余全部收进这里——这是防止界面变乱的主要手段。
    const items = typeof view.menu === 'function' ? (view.menu() || []) : [];
    if (items.length) {
      const topRight = document.getElementById('topRight');
      topRight.innerHTML = '<button class="top-btn" id="menuBtn" aria-label="更多操作">⋯</button>';
      // 点开时才取一次，保证拿到的是当前状态
      document.getElementById('menuBtn').onclick = () => openMenu(view.title || '', view.menu() || []);
    }

    for (const btn of document.querySelectorAll('#tabbar .tab')) {
      btn.classList.toggle('active', btn.dataset.route === name);
    }
  } catch (err) {
    console.error('[app] 渲染出错', err);
    document.getElementById('view').innerHTML =
      `<div class="empty">页面出错了：${String(err.message || err)}</div>`;
  } finally {
    rendering = false;
    if (pending) { pending = false; renderRoute(); }
  }
}

/**
 * 横向溢出排查：只在网址后面加 `?debug` 时才跑。
 *
 * 手机上打不开控制台，所以把「谁比屏幕宽」直接弹出来，截图就能发回来。
 * 起因：有反馈说手机能一路缩小、缩完卡片不在中心——那说明有个元素比屏幕宽，
 * 但我这边没法复现，干脆让页面自己报出来。
 */
function checkOverflow() {
  if (!String(location.search || '').includes('debug')) return;
  setTimeout(() => {
    const vw = document.documentElement.clientWidth;
    const sw = document.documentElement.scrollWidth;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      if (bad.length >= 15) break;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 1 || r.left < -1) {
        const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).join('.');
        bad.push(`${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`
          + `\n  左 ${Math.round(r.left)} 右 ${Math.round(r.right)} 宽 ${Math.round(r.width)}`);
      }
    }
    openSheet(`
      <div class="sheet-title" style="font-size:var(--fs-lg)">横向溢出排查</div>
      <div class="sheet-sub">
        视口 ${vw}px · 文档宽 ${sw}px ·
        ${sw > vw + 1 ? '<b style="color:var(--bad)">有横向溢出</b>' : '<b style="color:var(--ok)">没有横向溢出</b>'}
      </div>
      ${bad.length
        ? `<div class="sheet-quote" style="font-family:var(--font-mono);font-size:var(--fs-xs);white-space:pre-wrap">${escape(bad.join('\n\n'))}</div>`
        : '<div class="sheet-text">没有元素超出屏幕宽度。</div>'}
      <div class="sheet-actions"><button class="btn block" data-close>关闭</button></div>
    `);
  }, 800);
}

async function boot() {
  initUI();

  // 标签栏
  for (const btn of document.querySelectorAll('#tabbar .tab')) {
    btn.addEventListener('click', () => {
      closeSheet();
      go(btn.dataset.route);
    });
  }
  document.getElementById('backBtn').addEventListener('click', () => {
    if (history.length > 1) history.back(); else go('papers');
  });
  window.addEventListener('hashchange', renderRoute);

  // 载入数据
  document.getElementById('view').innerHTML = '<div class="empty">正在载入…</div>';
  await Promise.all([store.init(), dict.loadDict()]);

  await renderRoute();
  checkOverflow();
}

boot();
