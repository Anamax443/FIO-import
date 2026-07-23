/**
 * Samostatná, tisknutelná dokumentace: HTML ke stažení i pro tisk / uložení do PDF.
 * Bez knihoven — vše se skládá z řetězců, aby appka zůstala bez závislostí.
 * Světlý tiskový motiv a @media print pravidla stejně jako report.js.
 */

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/** Odstavce oddělené prázdným řádkem → samostatné <p> (delší texty se líp čtou i tisknou). */
function paras(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
}

/**
 * Sekce dokumentace (pole {h, p}) → samostatný HTML dokument.
 * Sekce se automaticky číslují (CSS counter) kvůli přehlednosti v tisku.
 */
export function buildDocHtml(sections, meta, labels) {
  const body = sections.map((s) => `
    <section>
      <h2>${esc(s.h)}</h2>
      ${paras(s.p)}
    </section>`).join('');

  const url = meta.url ? ` · ${esc(meta.url)}` : '';

  return `<!doctype html><html lang="${esc(meta.lang)}"><head><meta charset="utf-8">
<title>${esc(labels.docTitle)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.6 "Segoe UI", system-ui, sans-serif; color: #1a1f26; margin: 32px auto; max-width: 820px; padding: 0 24px; counter-reset: sec; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: #556; font-size: 14px; margin: 0 0 4px; }
  .meta { color: #778; font-size: 12px; margin-bottom: 24px; border-bottom: 1px solid #dde; padding-bottom: 12px; }
  section { margin: 0 0 18px; break-inside: avoid; }
  h2 { font-size: 15px; margin: 22px 0 6px; }
  h2::before { counter-increment: sec; content: counter(sec) ". "; color: #8894a2; font-variant-numeric: tabular-nums; }
  p { margin: 0 0 8px; max-width: 78ch; }
  footer { margin-top: 28px; border-top: 1px solid #dde; padding-top: 10px; color: #99a; font-size: 11px; }
  a { color: #14496b; }
  @media print {
    body { margin: 0; max-width: none; padding: 0; }
    h2 { break-after: avoid; }
    section { break-inside: avoid; }
    a { color: inherit; text-decoration: none; }
  }
</style></head><body>
<h1>${esc(labels.docTitle)}</h1>
<p class="sub">${esc(labels.subtitle)}</p>
<div class="meta">${esc(labels.generatedAt)}: ${esc(meta.now)} · ${esc(labels.version)}: ${esc(meta.commit)}${url}</div>
${body}
<footer>${esc(labels.footer)}</footer>
</body></html>`;
}
