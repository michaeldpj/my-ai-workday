export function mdInline(text) {
  let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Links are lifted out before the emphasis rules run, because an underscore
  // or asterisk inside a URL is part of the URL, not a formatting mark. Only
  // http(s). The href is already entity-escaped, so a quote cannot close the
  // attribute. \u0000 cannot occur in text that came through JSON.
  const links = [];
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, href) => {
    links.push(`<a href="${href}" target="_blank" rel="noopener">${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/_(.+?)_/g, '<em>$1</em>');
  s = s.replace(/`(.+?)`/g, '<code>$1</code>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => links[Number(i)]);
}

const escBlock = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Split on ``` fences into alternating prose and code segments. An open fence runs to the end. */
function splitFences(text) {
  const out = [];
  let buf = [];
  let code = false;
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      out.push({ code, body: buf.join('\n') });
      buf = [];
      code = !code;
      continue;
    }
    buf.push(line);
  }
  out.push({ code, body: buf.join('\n') });
  return out;
}

export function renderMarkdown(text) {
  return splitFences(text)
    .map((s) => (s.code ? `<pre><code>${escBlock(s.body)}</code></pre>` : renderBlocks(s.body)))
    .join('');
}

/** Headings, rules, lists, tables, and paragraphs. Fences are already cut out. */
function renderBlocks(text) {
  let html = '';
  let inUl = false;
  let inOl = false;
  let inTable = false;
  let tableHdrDone = false;
  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };
  const closeTable = () => {
    if (!inTable) return;
    html += tableHdrDone ? '</tbody></table>' : '</table>';
    inTable = false; tableHdrDone = false;
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('|') && t.endsWith('|') && t.length > 1) {
      closeList();
      if (/^\|[\s\-:|]+\|$/.test(t)) {
        if (inTable && !tableHdrDone) { html += '</thead><tbody>'; tableHdrDone = true; }
        continue;
      }
      const cells = t.slice(1, -1).split('|').map(c => mdInline(c.trim()));
      if (!inTable) { html += '<table class="md-table"><thead>'; inTable = true; }
      const tag = tableHdrDone ? 'td' : 'th';
      html += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      continue;
    }
    closeTable();
    if (t.startsWith('### '))       { closeList(); html += `<h3>${mdInline(t.slice(4))}</h3>`; }
    else if (t.startsWith('## '))   { closeList(); html += `<h2>${mdInline(t.slice(3))}</h2>`; }
    else if (t.startsWith('# '))    { closeList(); html += `<h2>${mdInline(t.slice(2))}</h2>`; }
    else if (/^-{3,}$/.test(t))     { closeList(); html += '<hr>'; }
    else if (/^\d+\.\s/.test(t))    { if (inUl) { html += '</ul>'; inUl = false; } if (!inOl) { html += '<ol>'; inOl = true; } html += `<li>${mdInline(t.replace(/^\d+\.\s/, ''))}</li>`; }
    else if (t.startsWith('- ') || t.startsWith('* ')) { if (inOl) { html += '</ol>'; inOl = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += `<li>${mdInline(t.slice(2))}</li>`; }
    else if (t === '')               { closeList(); }
    else                             { closeList(); html += `<p>${mdInline(t)}</p>`; }
  }
  closeList(); closeTable();
  return html;
}
