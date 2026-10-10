/**
 * SM-2 间隔重复算法（SuperMemo 2 的实用变体）
 *
 * 卡片有四个评分档：
 *   AGAIN(1) 忘记  → 当天重来，10 分钟后再次出现
 *   HARD (3) 模糊  → 间隔增长打折
 *   GOOD (4) 记得  → 正常增长
 *   EASY (5) 简单  → 首次就跳更长间隔
 *
 * ease（难度系数）初始 2.5，范围 [1.3, 3.0]。间隔 = 上次间隔 × ease。
 */

export const QUALITY = { AGAIN: 1, HARD: 3, GOOD: 4, EASY: 5 };

export const DAY = 86400000;
const RELEARN_MS = 10 * 60 * 1000; // 忘记后 10 分钟重新出现

export function newProgress(now = Date.now()) {
  return {
    ease: 2.5,
    interval: 0,   // 天
    reps: 0,       // 连续答对次数
    lapses: 0,     // 遗忘次数
    again: 0,      // 累计点过"忘记"的次数（用于错词榜）
    due: now,
    last: 0,
    history: [],
  };
}

/** 根据本次评分，返回更新后的进度对象（不修改入参） */
export function schedule(prev, quality, now = Date.now()) {
  const p = prev
    ? { ...prev, history: Array.isArray(prev.history) ? [...prev.history] : [] }
    : newProgress(now);

  let ease = typeof p.ease === 'number' ? p.ease : 2.5;
  let reps = p.reps || 0;

  if (quality < 3) {
    // 遗忘：重置连击，降低难度系数，当天重现
    reps = 0;
    ease = Math.max(1.3, ease - 0.2);
    p.lapses = (p.lapses || 0) + 1;
    p.interval = 0;
    p.due = now + RELEARN_MS;
  } else {
    // SM-2 难度系数更新公式
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    ease = Math.min(3.0, Math.max(1.3, ease));
    reps += 1;

    let interval;
    if (reps === 1) {
      interval = quality === QUALITY.EASY ? 3 : 1;
    } else if (reps === 2) {
      interval = quality === QUALITY.EASY ? 7 : 6;
    } else {
      const factor = quality === QUALITY.HARD ? ease * 0.8 : ease;
      interval = Math.round(Math.max(1, p.interval || 1) * factor);
    }
    p.interval = Math.max(1, Math.min(365, interval));
    p.due = now + p.interval * DAY;
  }

  p.ease = ease;
  p.reps = reps;
  p.again = (p.again || 0) + (quality < 3 ? 1 : 0);
  p.last = now;
  p.history.push({ t: now, q: quality });
  if (p.history.length > 60) p.history = p.history.slice(-60);

  return p;
}

/** 卡片处于哪个阶段：new / learning / young / mature */
export function stageOf(p) {
  if (!p || !p.reps) return 'new';
  if (p.interval >= 21) return 'mature';
  if (p.interval >= 1) return 'young';
  return 'learning';
}

export function isDue(p, now = Date.now()) {
  return !!p && p.reps > 0 && p.due <= now;
}

/** 把间隔天数变成人话 */
export function intervalLabel(days) {
  if (!days || days < 1) return '今天';
  if (days === 1) return '1 天';
  if (days < 30) return `${days} 天`;
  const m = Math.round(days / 30 * 10) / 10;
  if (days < 365) return `${m} 个月`;
  return `${Math.round(days / 365 * 10) / 10} 年`;
}

/* 说明：早先还有个 previewInterval()，给复习页按钮显示「点下去下次什么时候见」。
   复习页已经去掉，这个函数就没人调了，已删除。 */
