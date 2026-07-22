/**
 * Export přehledu dávky: CSV, samostatné HTML, PDF (přes tisk).
 * Bez knihoven — vše se skládá z řetězců, aby appka zůstala bez závislostí.
 */

/** Souhrny pro dashboard — počty a součty podle zdroje, kategorie a stavu. */
export function summarize(rows) {
  const active = rows.filter((r) => r.include);
  const sum = (list) => list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const round = (n) => Math.round(n * 100) / 100;

  const group = (keyFn) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyFn(r) || '—';
      const g = map.get(key) ?? { key, count: 0, active: 0, total: 0 };
      g.count++;
      if (r.include) { g.active++; g.total += Number(r.amount) || 0; }
      map.set(key, g);
    }
    return [...map.values()].map((g) => ({ ...g, total: round(g.total) }))
      .sort((a, b) => b.total - a.total);
  };

  return {
    count: rows.length,
    activeCount: active.length,
    total: round(sum(active)),
    claimed: rows.filter((r) => r.status === 'ALREADY_CLAIMED').length,
    generated: rows.filter((r) => r.status === 'ALREADY_GENERATED').length,
    duplicate: rows.filter((r) => r.status === 'DUPLICATE_IN_BATCH').length,
    mandatory: rows.filter((r) => r.mandatory).length,
    mandatoryTotal: round(sum(rows.filter((r) => r.mandatory && r.include))),
    bySource: group((r) => r.source),
    byCategory: group((r) => r.kategorie),
    byStatus: group((r) => r.status),
  };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV pro Excel: středník, CRLF, desetinná čárka, BOM (aby Excel poznal UTF-8). */
export function buildCsv(rows, labels) {
  const header = [labels.source, labels.status, labels.date, labels.category, labels.amount, labels.include, labels.message];
  const lines = [header.map(csvCell).join(';')];

  for (const r of rows) {
    lines.push([
      r.source,
      labels.statusMap[r.status] ?? r.status,
      r.date_txn ?? '',
      r.kategorie ?? '',
      String(r.amount).replace('.', ','),
      r.include ? labels.yes : labels.no,
      r.message,
    ].map(csvCell).join(';'));
  }

  return '﻿' + lines.join('\r\n') + '\r\n';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Samostatné HTML — použije se pro stažení i pro tisk do PDF. */
export function buildReportHtml(rows, s, labels, meta) {
  const fmt = (n) => new Intl.NumberFormat(labels.locale, { minimumFractionDigits: 2 }).format(n);

  const breakdown = (title, groups, keyLabel) => `
    <h2>${esc(title)}</h2>
    <table class="grp">
      <thead><tr><th>${esc(keyLabel)}</th><th class="n">${esc(labels.active)}</th><th class="n">${esc(labels.sum)}</th></tr></thead>
      <tbody>${groups.map((g) => `
        <tr><td>${esc(labels.statusMap[g.key] ?? g.key)}</td><td class="n">${g.active}/${g.count}</td><td class="n">${fmt(g.total)}</td></tr>`).join('')}
      </tbody>
    </table>`;

  const rowsHtml = rows.map((r) => `
    <tr class="${r.include ? '' : 'off'}">
      <td>${esc(r.source)}</td>
      <td>${esc(labels.statusMap[r.status] ?? r.status)}</td>
      <td>${esc(r.date_txn ?? '')}</td>
      <td>${esc(r.kategorie ?? '')}</td>
      <td class="n">${fmt(r.amount)}</td>
      <td>${r.include ? '✓' : '✕'}</td>
      <td>${esc(r.message)}</td>
    </tr>`).join('');

  return `<!doctype html><html lang="${labels.lang}"><head><meta charset="utf-8">
<title>${esc(labels.reportTitle)} ${esc(meta.date)}</title>
<style>
  body { font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #1a1f26; margin: 28px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .meta { color: #667; font-size: 12px; margin-bottom: 20px; }
  h2 { font-size: 14px; margin: 22px 0 6px; border-bottom: 1px solid #ccd; padding-bottom: 3px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; margin: 8px 0 4px; }
  .card { border: 1px solid #ccd; border-radius: 6px; padding: 10px 14px; min-width: 130px; }
  .card .k { color: #667; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .card .v { font-size: 18px; font-weight: 600; margin-top: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 4px; }
  th, td { border: 1px solid #dde; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #f2f4f7; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.grp { width: auto; min-width: 340px; }
  tr.off td { color: #99a; text-decoration: line-through; }
  @media print { body { margin: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style></head><body>
<h1>${esc(labels.reportTitle)}</h1>
<div class="meta">${esc(labels.due)}: ${esc(meta.date)} · ${esc(labels.generatedAt)}: ${esc(meta.now)} · ${esc(labels.version)}: ${esc(meta.commit)}</div>

<div class="cards">
  <div class="card"><div class="k">${esc(labels.activeOrders)}</div><div class="v">${s.activeCount}</div></div>
  <div class="card"><div class="k">${esc(labels.checksum)}</div><div class="v">${fmt(s.total)} CZK</div></div>
  <div class="card"><div class="k">${esc(labels.mandatory)}</div><div class="v">${s.mandatory} · ${fmt(s.mandatoryTotal)} CZK</div></div>
  <div class="card"><div class="k">${esc(labels.claimed)}</div><div class="v">${s.claimed}</div></div>
  <div class="card"><div class="k">${esc(labels.generated)}</div><div class="v">${s.generated}</div></div>
  <div class="card"><div class="k">${esc(labels.duplicate)}</div><div class="v">${s.duplicate}</div></div>
</div>

${breakdown(labels.bySource, s.bySource, labels.source)}
${breakdown(labels.byCategory, s.byCategory, labels.category)}

<h2>${esc(labels.allRows)}</h2>
<table>
  <thead><tr>
    <th>${esc(labels.source)}</th><th>${esc(labels.status)}</th><th>${esc(labels.date)}</th>
    <th>${esc(labels.category)}</th><th class="n">${esc(labels.amount)}</th><th>${esc(labels.include)}</th><th>${esc(labels.message)}</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
</body></html>`;
}
