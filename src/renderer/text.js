/**
 * Text helpers shared by every renderer module. One escape and one relative
 * clock, so the three views cannot drift on how they quote or date things.
 */
export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A string argument for an inline handler: onclick="fn('<here>')". JS-escape
 * first, for the single-quoted literal, then HTML-escape, because the browser
 * decodes the attribute before it parses the JavaScript inside it. jsEsc did
 * only the first half, so a double quote ended the attribute.
 */
export function jsAttr(s) {
  return esc(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
}

export function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  const wks = Math.floor(days / 7);
  return wks + 'w ago';
}
