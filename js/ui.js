/** 通用 UI：路由跳转、Toast、底部弹层、右上角菜单、确认框 */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ------------------------- 路由 ------------------------- */

/** 跳转（哈希路由）。放在这里是为了让视图模块不必反向依赖 app.js */
export function go(name, arg = '') {
  const target = `#/${name}${arg ? '/' + arg : ''}`;
  if (location.hash === target) fireHashChange();
  else location.hash = target;
}

function fireHashChange() {
  try { window.dispatchEvent(new HashChangeEvent('hashchange')); }
  catch (e) {
    try { window.dispatchEvent(new Event('hashchange')); } catch (e2) { /* 环境不支持就算了 */ }
  }
}

/* ------------------------- Toast ------------------------- */

let toastTimer = null;

export function toast(msg, ms = 1700) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/* ------------------------- 弹层 ------------------------- */

let sheetCloseCb = null;

export function openSheet(html, onClose) {
  const el = document.getElementById('sheet');
  document.getElementById('sheetBody').innerHTML = html;
  el.classList.remove('hidden');
  sheetCloseCb = onClose || null;
}

export function closeSheet() {
  const el = document.getElementById('sheet');
  if (el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  document.getElementById('sheetBody').innerHTML = '';
  const cb = sheetCloseCb;
  sheetCloseCb = null;
  if (cb) cb();
}

export function initUI() {
  document.getElementById('sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
}

/**
 * 右上角「⋯」菜单。
 * 次要操作都收在这里，页面上只留主操作——这是避免界面变乱的主要手段。
 *
 * @param {string} title 菜单标题
 * @param {Array<{label:string, hint?:string, action?:Function, danger?:boolean, disabled?:boolean}>} items
 */
export function openMenu(title, items) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return;

  openSheet(`
    ${title ? `<div class="menu-title">${esc(title)}</div>` : ''}
    ${list.map((it, i) => `
      <button class="menu-item${it.danger ? ' danger' : ''}" data-mi="${i}"${it.disabled ? ' disabled' : ''}>
        <span class="menu-label">${esc(it.label)}</span>
        ${it.hint ? `<span class="menu-hint">${esc(it.hint)}</span>` : ''}
      </button>`).join('')}
  `);

  for (const b of document.querySelectorAll('#sheetBody [data-mi]')) {
    b.onclick = () => {
      const it = list[Number(b.dataset.mi)];
      closeSheet();
      // 先关弹层再执行，避免动作里又要开新弹层
      if (it && it.action) setTimeout(() => it.action(), 0);
    };
  }
}

/* ------------------------- 确认框 ------------------------- */

export function confirmBox(message, { ok = '确定', cancel = '取消' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value) => {
      if (answered) return;
      answered = true;
      closeSheet();
      resolve(value);
    };
    openSheet(`
      <div class="sheet-text" style="padding-right:30px">${message}</div>
      <div class="sheet-actions">
        <button class="btn primary block" id="cfmYes">${esc(ok)}</button>
        <button class="btn block" id="cfmNo">${esc(cancel)}</button>
      </div>
    `, () => finish(false));
    document.getElementById('cfmYes').onclick = () => finish(true);
    document.getElementById('cfmNo').onclick = () => finish(false);
  });
}

/* ------------------------- 小组件 ------------------------- */

export function bar(pct) {
  return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></i></div>`;
}
