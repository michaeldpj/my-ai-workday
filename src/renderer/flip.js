/**
 * A tiny dependency-free FLIP helper for the Ideas board. When renderIdeas
 * replaces the board, a card that changed column should slide from where it was
 * to where it landed, so a card advancing on its own when a session finishes
 * reads as the system working rather than a teleport. The pure math is unit
 * tested; the DOM play is guarded by prefers-reduced-motion.
 */

export function flipDelta(prev, next) {
  return { dx: prev.left - next.left, dy: prev.top - next.top };
}

export function shouldAnimate(prev, next, threshold = 3) {
  const { dx, dy } = flipDelta(prev, next);
  return Math.max(Math.abs(dx), Math.abs(dy)) >= threshold;
}

const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Snapshot each card's viewport position by its data-id, before the DOM changes. */
export function captureRects(container, selector) {
  const m = new Map();
  if (!container) return m;
  container.querySelectorAll(selector).forEach((el) => {
    if (!el.dataset.id) return;
    const r = el.getBoundingClientRect();
    m.set(el.dataset.id, { left: r.left, top: r.top });
  });
  return m;
}

/**
 * After the DOM has been replaced, slide each still-present card from its old
 * box to its new one. Cards with no prior position get a one-shot entrance mark
 * instead. No-op under reduced motion.
 */
export function playFlip(container, selector, prevRects, opts = {}) {
  if (!container || reduce()) return;
  const threshold = opts.threshold ?? 3;
  container.querySelectorAll(selector).forEach((el) => {
    const id = el.dataset.id;
    const prev = id ? prevRects.get(id) : null;
    if (!prev) { el.setAttribute('data-new', ''); return; }
    const r = el.getBoundingClientRect();
    const next = { left: r.left, top: r.top };
    if (!shouldAnimate(prev, next, threshold)) return;
    const { dx, dy } = flipDelta(prev, next);
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = 'transform var(--dur-slow) var(--ease-out)';
      el.style.transform = '';
      const clear = () => { el.style.transition = ''; el.removeEventListener('transitionend', clear); };
      el.addEventListener('transitionend', clear);
    });
  });
}
