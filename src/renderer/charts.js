/**
 * SVG builders for the Summary view. Pure: every function takes numbers and
 * strings and returns an SVG string. No DOM, no color hex — series color is
 * a CSS class (`ch-<key>`) so `styles.css` carries every palette value, and
 * every label goes through `esc` since repo, project, and issue titles are
 * untrusted. Empty input always draws a muted "No data" placeholder.
 */
import { esc } from './text.js';

const GAP = 2;
const RADIUS = 4;

function emptySvg(width, height) {
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="No data"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" class="ch-empty">No data</text></svg>`;
}

/** A rounded top rect, or a plain one when it isn't the topmost stacked segment. */
function segmentRect(x, y, w, h, key, round) {
  const r = round ? RADIUS : 0;
  return `<path class="ch-${esc(key)}" d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z" />`;
}

/** Stacked daily bars: one column per label, series stacked in the given order. */
export function barStrip({ series = [], labels = [], width = 600, height = 120, labelEvery = 7 }) {
  if (!labels.length || !series.length) return emptySvg(width, height);
  const n = labels.length;
  const colW = width / n;
  const barW = Math.max(1, colW - GAP);
  const max = Math.max(1, ...labels.map((_, i) => series.reduce((s, ser) => s + (ser.values[i] || 0), 0)));
  const scale = (height - 16) / max;
  let out = '';
  for (let i = 0; i < n; i += 1) {
    const x = i * colW + GAP / 2;
    let y = height;
    const parts = [];
    series.forEach((ser, si) => {
      const v = ser.values[i] || 0;
      if (v <= 0) return;
      const h = v * scale;
      y -= h;
      const isTop = series.slice(si + 1).every((rest) => !(rest.values[i] > 0));
      parts.push(segmentRect(x, y, barW, h, ser.key, isTop));
    });
    const titleParts = series.map((ser) => `${ser.values[i] || 0} ${esc(ser.key)}`).join(', ');
    out += `<g><title>${esc(labels[i])}: ${titleParts}</title>${parts.join('')}</g>`;
    if (i % labelEvery === 0) out += `<text x="${x}" y="${height + 12}" class="ch-label">${esc(labels[i])}</text>`;
  }
  return `<svg viewBox="0 0 ${width} ${height + 20}" width="${width}" height="${height + 20}" role="img">${out}</svg>`;
}

/** Horizontal bars, one row per entry, label left and value at the bar's end. */
export function hBars({ rows = [], width = 400, max }) {
  const rowH = 22;
  const height = rows.length * rowH;
  if (!rows.length) return emptySvg(width, 40);
  const m = max || Math.max(1, ...rows.map((r) => r.value));
  const labelW = 110;
  const barMax = width - labelW - 40;
  let out = '';
  rows.forEach((r, i) => {
    const y = i * rowH;
    const w = Math.max(1, (r.value / m) * barMax);
    const key = r.key || 'commit';
    out += `<text x="0" y="${y + rowH / 2 + 4}" class="ch-label">${esc(r.label)}</text>`;
    out += `<g><title>${esc(r.label)}: ${r.value}</title>${segmentRect(labelW, y + 3, w, rowH - GAP * 3, key, true)}</g>`;
    out += `<text x="${labelW + w + 6}" y="${y + rowH / 2 + 4}" class="ch-value">${r.value}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${out}</svg>`;
}

/** Two thin bars per week, side by side, for PR opened vs merged. */
export function pairedWeeks({ weeks = [], keys = ['a', 'b'], width = 600, height = 120 }) {
  if (!weeks.length) return emptySvg(width, height);
  const [ka, kb] = keys;
  const n = weeks.length;
  const colW = width / n;
  const barW = Math.max(1, (colW - GAP * 3) / 2);
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.a, w.b)));
  const scale = (height - 16) / max;
  let out = '';
  weeks.forEach((w, i) => {
    const x = i * colW + GAP;
    const ha = w.a * scale;
    const hb = w.b * scale;
    out += `<g><title>${esc(w.label)}: ${w.a} ${esc(ka)}, ${w.b} ${esc(kb)}</title>`;
    if (ha > 0) out += segmentRect(x, height - ha, barW, ha, ka, true);
    if (hb > 0) out += segmentRect(x + barW + GAP, height - hb, barW, hb, kb, true);
    out += '</g>';
    out += `<text x="${x + barW}" y="${height + 12}" class="ch-label">${esc(w.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height + 20}" width="${width}" height="${height + 20}" role="img">${out}</svg>`;
}

/** Horizontal stacked bars, one row per entry, for issue opened/closed/open per project. */
export function stackedRows({ rows = [], width = 400 }) {
  const rowH = 22;
  const height = rows.length * rowH;
  if (!rows.length) return emptySvg(width, 40);
  const labelW = 110;
  const barMax = width - labelW - 8;
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((s, p) => s + p.value, 0)));
  const scale = barMax / max;
  let out = '';
  rows.forEach((r, i) => {
    const y = i * rowH;
    const total = r.parts.reduce((s, p) => s + p.value, 0);
    const titleParts = r.parts.map((p) => `${p.value} ${esc(p.key)}`).join(', ');
    out += `<text x="0" y="${y + rowH / 2 + 4}" class="ch-label">${esc(r.label)}</text>`;
    out += `<g><title>${esc(r.label)}: ${titleParts}</title>`;
    let x = labelW;
    r.parts.forEach((p, pi) => {
      if (p.value <= 0) return;
      const w = Math.max(1, p.value * scale);
      const isLast = r.parts.slice(pi + 1).every((rest) => rest.value <= 0);
      out += segmentRect(x, y + 3, w, rowH - GAP * 3, p.key, isLast);
      x += w;
    });
    out += `</g>`;
    if (!total) out += `<text x="${labelW}" y="${y + rowH / 2 + 4}" class="ch-value">0</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">${out}</svg>`;
}
