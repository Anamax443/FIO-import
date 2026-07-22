import { detectKind } from './detect.js';
import { STRINGS } from './i18n.js';
import { buildCsv, buildReportHtml, summarize } from './report.js';

const $ = (id) => document.getElementById(id);
const TEXTAREAS = ['revolut', 'historyCsv', 'prevXml'];

let lang = localStorage.getItem('fio-lang') || 'cs';
let t = STRINGS[lang];
let rows = [];
let report = { new: 0, alreadyClaimed: 0, alreadyGenerated: 0, duplicateInBatch: 0 };
let history = [];   // celá historie pro dedup — k prohlížení v záložce Historie

/* ---------- i18n ---------- */

function applyLang() {
  t = STRINGS[lang];
  document.documentElement.lang = lang;
  localStorage.setItem('fio-lang', lang);

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = t[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    const value = t[el.dataset.i18nTitle];
    if (typeof value === 'string') el.title = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const value = t[el.dataset.i18nPlaceholder];
    if (typeof value === 'string') el.placeholder = value;
  }
  tickClock();
  renderHelp();
  if (template.length) renderTemplate();
  render();
  renderHistory();
}

/* ---------- přístup ---------- */

/**
 * Volání API. Přes Cloudflare Access se přihlášení nese v cookie automaticky;
 * záložní režim (sdílený token) si token drží v localStorage a doptá se na něj.
 */
async function api(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const token = localStorage.getItem('fio-token');
  if (token) headers['x-app-token'] = token;

  let res = await fetch(path, { ...options, headers, credentials: 'same-origin' });

  if (res.status === 401) {
    const entered = prompt(t.tokenPrompt);
    if (!entered) return res;
    localStorage.setItem('fio-token', entered.trim());
    headers['x-app-token'] = entered.trim();
    res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    if (res.status === 401) localStorage.removeItem('fio-token');
  }

  return res;
}

/* ---------- pomocné ---------- */

function showMessage(text, kind = 'ok', list = []) {
  const box = $('message');
  if (!text) { box.innerHTML = ''; return; }
  const items = list.length ? `<ul>${list.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : '';
  box.innerHTML = `<div class="msg ${kind}">${escapeHtml(text)}${items}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Lokální datum jako RRRR-MM-DD (toISOString by posunul o časové pásmo). */
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmt(n) {
  return new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-US', { minimumFractionDigits: 2 }).format(n);
}

/* ---------- render tabulky ---------- */

const FILTER_IDS = ['fInclude', 'fSource', 'fStatus', 'fDate', 'fCat', 'fMin', 'fMax', 'fText', 'fMandatory'];

/** Vyhledávání bez ohledu na diakritiku a velikost písmen. */
function fold(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function visibleRows() {
  const inc = $('fInclude').value;
  const src = $('fSource').value;
  const status = $('fStatus').value;
  const date = $('fDate').value.trim();
  const cat = $('fCat').value;
  const min = $('fMin').value === '' ? null : Number($('fMin').value);
  const max = $('fMax').value === '' ? null : Number($('fMax').value);
  const text = fold($('fText').value.trim());
  const mandatoryOnly = $('fMandatory').checked;

  return rows.filter((r) => {
    if (inc === 'on' && !r.include) return false;
    if (inc === 'off' && r.include) return false;
    if (src && r.source !== src) return false;
    if (status && r.status !== status) return false;
    if (date && !(r.date_txn ?? '').includes(date)) return false;
    if (cat && (r.kategorie ?? '—') !== cat) return false;
    if (min !== null && r.amount < min) return false;
    if (max !== null && r.amount > max) return false;
    if (mandatoryOnly && !r.mandatory) return false;
    if (text && !fold(`${r.message} ${r.merchant ?? ''} ${r.kategorie ?? ''}`).includes(text)) return false;
    return true;
  });
}

/** Nabídka kategorií se plní z dat — každá dávka má jiné. */
function refreshCategoryFilter() {
  const select = $('fCat');
  const cats = [...new Set(rows.map((r) => r.kategorie ?? '—'))].sort((a, b) => a.localeCompare(b, 'cs'));
  const options = ['', ...cats];
  const current = select.value;

  if (select.dataset.sig === options.join('|')) return;
  select.dataset.sig = options.join('|');
  select.innerHTML = options
    .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c === '' ? t.filterAll : c)}</option>`)
    .join('');
  select.value = options.includes(current) ? current : '';
}

function filtersActive() {
  return FILTER_IDS.some((id) => ($(id).type === 'checkbox' ? $(id).checked : $(id).value !== ''));
}

function clearFilters() {
  for (const id of FILTER_IDS) {
    if ($(id).type === 'checkbox') $(id).checked = false;
    else $(id).value = '';
  }
  render();
}

function render() {
  const tbody = $('rows');
  const list = visibleRows();

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--fg-dim)">${escapeHtml(t.noRows)}</td></tr>`;
  } else if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--fg-dim)">${escapeHtml(t.noMatch)}</td></tr>`;
    bindRowEvents();
  } else {
    tbody.innerHTML = list.map(rowHtml).join('');
    bindRowEvents();
  }

  refreshCategoryFilter();
  $('shown').textContent = rows.length ? t.shown(list.length, rows.length) : '';
  $('clearFilters').disabled = !filtersActive();
  updateSummary();
}

function rowHtml(r) {
  const cls = [r.include ? '' : 'excluded', r.mandatory ? 'mandatory' : ''].filter(Boolean).join(' ');
  const source = r.source === 'pravidelna' ? (lang === 'cs' ? 'pravidelná' : 'recurring') : r.source;
  return `
    <tr class="${cls}" data-id="${escapeHtml(r.id)}">
      <td class="keep"><input type="checkbox" class="inc" ${r.include ? 'checked' : ''} title="${escapeHtml(t.includeTip)}"></td>
      <td class="keep"><span class="badge src">${escapeHtml(source)}</span></td>
      <td class="keep"><span class="badge ${r.status}" title="${escapeHtml(r.status)}">${escapeHtml(t.status[r.status] ?? r.status)}</span></td>
      <td>${escapeHtml(r.date_txn ?? '')}</td>
      <td>${escapeHtml(r.kategorie ?? '')}</td>
      <td class="num"><input type="number" step="0.01" class="amt" value="${r.amount}" title="${escapeHtml(t.amountTip)}"></td>
      <td>
        <input type="text" class="msgtext" value="${escapeHtml(r.message)}" title="${escapeHtml(t.messageTip)}">
        ${r.note ? `<span class="note">${escapeHtml(r.note)}</span>` : ''}
      </td>
    </tr>`;
}

function bindRowEvents() {
  for (const tr of $('rows').querySelectorAll('tr[data-id]')) {
    const row = rows.find((r) => r.id === tr.dataset.id);
    if (!row) continue;

    tr.querySelector('.inc').addEventListener('change', (e) => {
      // Ochrana mandatorních — vyřazení jen s potvrzením.
      if (row.mandatory && !e.target.checked && !confirm(t.mandatoryConfirm)) {
        e.target.checked = true;
        return;
      }
      row.include = e.target.checked;
      tr.classList.toggle('excluded', !row.include);
      updateSummary();
    });

    tr.querySelector('.amt').addEventListener('input', (e) => {
      const value = Number(String(e.target.value).replace(',', '.'));
      if (Number.isFinite(value)) { row.amount = value; updateSummary(); }
    });

    tr.querySelector('.msgtext').addEventListener('input', (e) => { row.message = e.target.value; });
  }
}

function updateSummary() {
  const active = rows.filter((r) => r.include);
  const total = active.reduce((sum, r) => sum + r.amount, 0);
  $('sumCount').textContent = active.length;
  $('sumTotal').textContent = fmt(Math.round(total * 100) / 100);
  $('sumClaimed').textContent = rows.filter((r) => r.status === 'ALREADY_CLAIMED').length;
  $('sumGenerated').textContent = rows.filter((r) => r.status === 'ALREADY_GENERATED').length;
  $('sumDup').textContent = rows.filter((r) => r.status === 'DUPLICATE_IN_BATCH').length;
  $('generate').disabled = active.length === 0;
  renderDash();   // dashboard drží krok s ručními úpravami (include, částka)
}

/* ---------- šablona pravidelných / mandatorních plateb ---------- */

let template = [];

async function loadTemplate(useDefaults = false) {
  try {
    const res = await api(`/api/template${useDefaults ? '?defaults=1' : ''}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    template = data.template ?? [];
    renderTemplate();
  } catch (err) {
    showMessage(String(err.message ?? err), 'err');
  }
}

/** Měsíc a rok zvolený pro náhled — výchozí je aktuální měsíc. */
function previewMonth() {
  const value = $('tplMonth').value || isoDate(new Date()).slice(0, 7);
  const [rok, mes] = value.split('-');
  return { rok, mesic: MONTHS[Number(mes) - 1] ?? '', value };
}

function renderRow(row) {
  const { mesic, rok } = previewMonth();
  return row.template.replace(/\{mesic\}/g, mesic).replace(/\{rok\}/g, rok);
}

function renderTemplate() {
  const rendered = template.map(renderRow);

  $('tplRows').innerHTML = template.map((row, i) => {
    const preview = rendered[i];
    const over = preview.length > 140;
    return `
    <tr data-i="${i}"${row.mandatory ? ' class="mandatory"' : ''}>
      <td class="keep"><label><input type="checkbox" class="tplM" ${row.mandatory ? 'checked' : ''}>
        <span class="hint">${escapeHtml(t.tplMandatoryShort)}</span></label></td>
      <td class="num"><input type="number" step="0.01" class="tplA" value="${row.amount}"></td>
      <td>
        <input type="text" class="tplT" value="${escapeHtml(row.template)}">
        <div class="tplPreview${over ? ' over' : ''}">
          <span class="txt">${escapeHtml(preview)}</span>
          <span class="len">${t.tplChars(preview.length)}</span>
        </div>
      </td>
      <td><button class="tplDel" type="button" title="${escapeHtml(t.tplDelete)}">✕</button></td>
    </tr>`;
  }).join('');

  for (const tr of $('tplRows').querySelectorAll('tr[data-i]')) {
    const row = template[Number(tr.dataset.i)];
    tr.querySelector('.tplM').addEventListener('change', (e) => {
      row.mandatory = e.target.checked;
      tr.classList.toggle('mandatory', row.mandatory);
      updateTplSummary();
    });
    tr.querySelector('.tplA').addEventListener('input', (e) => {
      const v = Number(String(e.target.value).replace(',', '.'));
      if (Number.isFinite(v)) { row.amount = v; updateTplSummary(); }
    });
    tr.querySelector('.tplT').addEventListener('input', (e) => {
      row.template = e.target.value;
      const preview = renderRow(row);
      const box = tr.querySelector('.tplPreview');
      box.querySelector('.txt').textContent = preview;
      box.querySelector('.len').textContent = t.tplChars(preview.length);
      box.classList.toggle('over', preview.length > 140);
    });
    tr.querySelector('.tplDel').addEventListener('click', () => {
      template.splice(Number(tr.dataset.i), 1);
      renderTemplate();
    });
  }

  updateTplSummary();
}

function updateTplSummary() {
  const total = template.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const mandatory = template.filter((r) => r.mandatory).length;
  const { mesic, rok } = previewMonth();

  $('tplCount').textContent = template.length;
  $('tplMandatoryCount').textContent = mandatory;
  $('tplTotalCard').textContent = `${fmt(Math.round(total * 100) / 100)} CZK`;
  $('tplSummary').textContent = `${mesic} ${rok} — ${fmt(Math.round(total * 100) / 100)} CZK`;

  // Skutečná dávka jede podle data splatnosti; když se liší, je to vidět.
  const due = $('date').value;
  const dueMonth = due ? due.slice(0, 7) : '';
  const note = $('tplMonthNote');
  if (dueMonth && dueMonth !== previewMonth().value) {
    const [dRok, dMes] = dueMonth.split('-');
    note.textContent = t.tplMonthDiffers(MONTHS[Number(dMes) - 1] ?? '', dRok);
    note.classList.add('warn-text');
  } else {
    note.textContent = t.tplMonthSame;
    note.classList.remove('warn-text');
  }
}

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

async function saveTemplate() {
  try {
    const res = await api('/api/template', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    template = data.template ?? template;
    renderTemplate();
    showMessage(t.tplSaved(data.saved), 'ok');
  } catch (err) {
    showMessage(String(err.message ?? err), 'err');
  }
}

function setupTemplate() {
  // Výchozí je aktuální měsíc.
  $('tplMonth').value = isoDate(new Date()).slice(0, 7);
  $('tplMonth').addEventListener('change', renderTemplate);
  $('tplMonthNow').addEventListener('click', () => {
    $('tplMonth').value = isoDate(new Date()).slice(0, 7);
    renderTemplate();
  });

  $('tplAdd').addEventListener('click', () => {
    template.push({ ord: template.length + 1, amount: 0, mandatory: false, template: `${t.tplNewText} {mesic} {rok}` });
    renderTemplate();
    $('tplRows').lastElementChild?.querySelector('.tplA')?.focus();
  });
  $('tplDefaults').addEventListener('click', () => {
    if (confirm(t.tplDefaultsConfirm)) loadTemplate(true);
  });
  $('tplSave').addEventListener('click', saveTemplate);
  loadTemplate();
}

/* ---------- hromadné úpravy zafiltrovaných řádků ---------- */

function bulkEdit(fn, { needsText = true } = {}) {
  const targets = visibleRows();
  if (targets.length === 0) { showMessage(t.bulkNone, 'warn'); return; }
  if (needsText && !$('bulkText').value && !$('bulkFind').value) { showMessage(t.bulkNoText, 'warn'); return; }

  for (const row of targets) {
    // Povinné platby chráníme i tady — hromadná úprava je nesmí tiše vypnout.
    if (row.mandatory && fn.name === 'turnOff') continue;
    fn(row);
  }

  render();

  const tooLong = targets.filter((r) => r.message.length > 140).length;
  showMessage(
    tooLong ? `${t.bulkDone(targets.length)} ${t.bulkTooLong(tooLong)}` : t.bulkDone(targets.length),
    tooLong ? 'warn' : 'ok',
  );
}

function setupBulk() {
  const text = () => $('bulkText').value;

  $('bulkPrefix').addEventListener('click', () =>
    bulkEdit((r) => { r.message = `${text()} ${r.message}`.trim(); }));

  $('bulkSuffix').addEventListener('click', () =>
    bulkEdit((r) => { r.message = `${r.message} ${text()}`.trim(); }));

  $('bulkDoReplace').addEventListener('click', () =>
    bulkEdit((r) => { r.message = r.message.split($('bulkFind').value).join($('bulkReplace').value).trim(); }));

  $('bulkOn').addEventListener('click', () =>
    bulkEdit(function turnOn(r) { r.include = true; }, { needsText: false }));

  $('bulkOff').addEventListener('click', () =>
    bulkEdit(function turnOff(r) { r.include = false; }, { needsText: false }));

  // Smazání je nevratné, proto potvrzení a ochrana povinných plateb.
  $('bulkDelete').addEventListener('click', () => {
    const targets = visibleRows();
    if (targets.length === 0) { showMessage(t.bulkNone, 'warn'); return; }

    const removable = targets.filter((r) => !r.mandatory);
    const keptMandatory = targets.length - removable.length;
    if (removable.length === 0) { showMessage(t.bulkOnlyMandatory, 'warn'); return; }
    if (!confirm(t.bulkDeleteConfirm(removable.length))) return;

    const doomed = new Set(removable.map((r) => r.id));
    rows = rows.filter((r) => !doomed.has(r.id));
    render();
    showMessage(
      keptMandatory ? `${t.bulkDeleted(removable.length)} ${t.bulkKeptMandatory(keptMandatory)}` : t.bulkDeleted(removable.length),
      keptMandatory ? 'warn' : 'ok',
    );
  });
}

/* ---------- akce ---------- */

async function process() {
  const btn = $('process');
  btn.disabled = true;
  showMessage(t.working, 'ok');

  try {
    const res = await api('/api/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: $('date').value,
        dateFrom: $('dateFrom').value || undefined,
        dateTo: $('dateTo').value || undefined,
        revolut: inputValue('revolut'),
        historyCsv: inputValue('historyCsv'),
        prevXml: inputValue('prevXml'),
        useAi: $('useAi').checked,
        useRecurring: $('useRecurring').checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    rows = data.rows;
    report = data.report;
    if (Array.isArray(data.history)) history = data.history;
    render();
    renderDash();
    renderHistory();

    const notes = [t.historyInfo(data.historySize)];
    if (data.withRecurring === false) notes.push(t.recurringOff);
    if (data.fromMovements > 0) notes.push(t.fromMovementsInfo(data.fromMovements));
    if (data.outOfRange > 0) notes.push(t.outOfRangeInfo(data.outOfRange));
    if (!data.aiUsed) notes.push(t.aiOff);
    showMessage(notes.join(' '), data.outOfRange > 0 ? 'warn' : 'ok');
  } catch (err) {
    showMessage(String(err.message ?? err), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function generate() {
  const btn = $('generate');
  btn.disabled = true;
  try {
    const res = await api('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: $('date').value, rows }),
    });

    if (!res.ok) {
      const data = await res.json();
      showMessage(data.error || t.problems, 'err', data.problems ?? []);
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fio-import-${$('date').value}.xml`;
    a.click();
    URL.revokeObjectURL(url);

    const count = res.headers.get('x-fio-count');
    const total = res.headers.get('x-fio-total');
    showMessage(`${t.generated} ${count} × ${t.sumTotal.toLowerCase()} ${total} CZK`, 'ok');
  } catch (err) {
    showMessage(String(err.message ?? err), 'err');
  } finally {
    updateSummary();
  }
}

/* ---------- přehled (dashboard) ---------- */

function grpTable(groups, keyLabelFn = (k) => k) {
  if (groups.length === 0) return `<p class="hint">—</p>`;
  return `<table class="grp">
    <thead><tr><th>${escapeHtml(t.dashKey)}</th><th class="num">${escapeHtml(t.dashActive)}</th><th class="num">${escapeHtml(t.dashSum)}</th></tr></thead>
    <tbody>${groups.map((g) => `
      <tr><td>${escapeHtml(keyLabelFn(g.key))}</td><td class="num">${g.active}/${g.count}</td><td class="num">${fmt(g.total)}</td></tr>`).join('')}
    </tbody></table>`;
}

function renderDash() {
  const empty = $('dashEmpty');
  const body = $('dashBody');
  if (rows.length === 0) {
    empty.textContent = t.dashEmpty;
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');

  const s = summarize(rows);
  $('dashCards').innerHTML = [
    [t.sumCount, s.activeCount],
    [t.sumTotal, `${fmt(s.total)} CZK`],
    [t.dashMandatory, `${s.mandatory} · ${fmt(s.mandatoryTotal)} CZK`],
    [t.sumClaimed, s.claimed],
    [t.sumGenerated, s.generated],
    [t.sumDup, s.duplicate],
  ].map(([k, v]) => `<div class="card"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div></div>`).join('');

  $('dashSource').innerHTML = grpTable(s.bySource, (k) => (k === 'pravidelna' ? t.srcRecurring : k));
  $('dashCategory').innerHTML = grpTable(s.byCategory);
}

/* ---------- export ---------- */

function exportLabels() {
  return {
    locale: lang === 'cs' ? 'cs-CZ' : 'en-US',
    lang,
    source: t.colSource, status: t.colStatus, date: t.colDate, category: t.colCategory,
    amount: t.colAmount, include: t.colInclude, message: t.colMessage,
    yes: lang === 'cs' ? 'ano' : 'yes', no: lang === 'cs' ? 'ne' : 'no',
    statusMap: t.status,
    reportTitle: t.reportTitle, due: t.date, generatedAt: t.reportGenerated, version: t.commit,
    active: t.dashActive, sum: t.dashSum, allRows: t.reportAllRows,
    activeOrders: t.sumCount, checksum: t.sumTotal, mandatory: t.dashMandatory,
    claimed: t.sumClaimed, generated: t.sumGenerated, duplicate: t.sumDup, bySource: t.bySource, byCategory: t.byCategory,
  };
}

function download(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function reportMeta() {
  return {
    date: $('date').value,
    now: new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
      .format(new Date(Date.now() + clockOffset)),
    commit: $('commit').textContent,
  };
}

function setupExport() {
  const guard = () => {
    if (rows.length === 0) { showMessage(t.dashEmpty, 'warn'); return false; }
    return true;
  };

  $('expCsv').addEventListener('click', () => {
    if (!guard()) return;
    download(`fio-prehled-${$('date').value}.csv`, 'text/csv;charset=utf-8', buildCsv(rows, exportLabels()));
  });

  $('expHtml').addEventListener('click', () => {
    if (!guard()) return;
    download(`fio-prehled-${$('date').value}.html`, 'text/html;charset=utf-8',
      buildReportHtml(rows, summarize(rows), exportLabels(), reportMeta()));
  });

  $('expPdf').addEventListener('click', () => {
    if (!guard()) return;
    // Bez knihoven: otevři report v novém okně a nech uživatele „Uložit jako PDF".
    const html = buildReportHtml(rows, summarize(rows), exportLabels(), reportMeta());
    const w = window.open('', '_blank');
    if (!w) { showMessage(t.popupBlocked, 'err'); return; }
    w.document.write(html);
    w.document.close();
    w.addEventListener('load', () => { w.focus(); w.print(); });
  });
}

/* ---------- historie (dohledání uplatněného) ---------- */

async function loadLedger() {
  try {
    const res = await api('/api/ledger');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    // Uploadovaná historie z posledního zpracování má přednost, doplní se databáze.
    const seen = new Set(history.map((h) => `${h.date_txn}|${h.amount}|${h.source}`));
    for (const e of data.ledger ?? []) {
      const k = `${e.date_txn}|${e.amount}|${e.source}`;
      if (!seen.has(k)) { history.push(e); seen.add(k); }
    }
    renderHistory();
    showMessage(t.histLoaded((data.ledger ?? []).length), data.source === 'none' ? 'warn' : 'ok');
  } catch (err) {
    showMessage(String(err.message ?? err), 'err');
  }
}

function visibleHistory() {
  const text = fold($('histText').value.trim());
  const from = $('histFrom').value;
  const to = $('histTo').value;
  const min = $('histMin').value === '' ? null : Number($('histMin').value);
  const max = $('histMax').value === '' ? null : Number($('histMax').value);

  return history.filter((h) => {
    if (from && (h.date_txn ?? '') < from) return false;
    if (to && (h.date_txn ?? '') > to) return false;
    if (min !== null && h.amount < min) return false;
    if (max !== null && h.amount > max) return false;
    if (text && !fold(`${h.merchant ?? ''} ${h.date_txn ?? ''} ${h.source ?? ''}`).includes(text)) return false;
    return true;
  }).sort((a, b) => (b.date_txn ?? '').localeCompare(a.date_txn ?? ''));
}

function renderHistory() {
  const list = visibleHistory();
  const tbody = $('histRows');

  if (history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="hint">${escapeHtml(t.histNone)}</td></tr>`;
  } else if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="hint">${escapeHtml(t.noMatch)}</td></tr>`;
  } else {
    tbody.innerHTML = list.slice(0, 2000).map((h) => `
      <tr>
        <td>${escapeHtml(h.date_txn ?? '')}</td>
        <td class="num">${fmt(h.amount)}</td>
        <td><span class="badge src">${escapeHtml(h.source ?? '')}</span></td>
        <td>${escapeHtml(h.merchant ?? '')}</td>
      </tr>`).join('') + (list.length > 2000
      ? `<tr><td colspan="4" class="hint">${escapeHtml(t.histCapped(list.length))}</td></tr>` : '');
  }

  const total = list.reduce((s, h) => s + (Number(h.amount) || 0), 0);
  $('histCount').textContent = `${list.length} / ${history.length}`;
  $('histTotal').textContent = fmt(Math.round(total * 100) / 100);
}

function setupHistory() {
  $('histLoad').addEventListener('click', loadLedger);
  for (const id of ['histText', 'histFrom', 'histTo', 'histMin', 'histMax']) {
    $(id).addEventListener('input', renderHistory);
  }
  $('histClear').addEventListener('click', () => {
    for (const id of ['histText', 'histFrom', 'histTo', 'histMin', 'histMax']) $(id).value = '';
    renderHistory();
  });
}

/* ---------- záložky ---------- */

const TABS = ['davka', 'prehled', 'historie', 'pravidelne', 'napoveda'];

function showTab(name) {
  const tab = TABS.includes(name) ? name : TABS[0];
  for (const id of TABS) {
    $(`page-${id}`).classList.toggle('hidden', id !== tab);
  }
  for (const btn of document.querySelectorAll('nav.tabs .tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

function setupTabs() {
  for (const btn of document.querySelectorAll('nav.tabs .tab')) {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  }
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  showTab(location.hash.slice(1));
}

function renderHelp() {
  $('helpBox').innerHTML = t.help.map((s) => `
    <h3>${escapeHtml(s.h)}</h3>
    <p>${escapeHtml(s.p)}</p>`).join('');
}

/* ---------- hlavička: čas a verze ze serveru ---------- */

/** Rozdíl mezi časem serveru a hodinami prohlížeče (ms). */
let clockOffset = 0;

async function syncHeader() {
  const dot = $('dot');
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    const v = await res.json();

    clockOffset = new Date(v.time).getTime() - Date.now();
    $('commit').textContent = v.commit;
    dot.className = 'dot online';
    dot.title = t.online;
  } catch {
    dot.className = 'dot offline';
    dot.title = t.offline;
  }
}

function tickClock() {
  const now = new Date(Date.now() + clockOffset);
  $('clock').textContent = new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(now);
}

/** Skutečná konektivita AI — ověří klíč i model přes /api/ai-check. */
async function syncAi() {
  const dot = $('aiDot');
  try {
    const res = await api('/api/ai-check');
    const v = await res.json();
    if (!v.configured) { dot.className = 'dot'; dot.title = t.aiNone; return; }
    if (v.ok) { dot.className = 'dot online'; dot.title = t.aiOnline(v.model); return; }
    dot.className = 'dot offline';
    dot.title = v.reason === 'no_credit' ? t.aiNoCredit
      : v.reason === 'auth' ? t.aiAuth
        : t.aiBad(v.error ?? '');
  } catch {
    dot.className = 'dot offline'; dot.title = t.aiBad('');
  }
}

function startHeaderClock() {
  syncHeader();
  syncAi();
  tickClock();
  setInterval(tickClock, 1000);
  // Přesync: srovná drift hodin a ukáže, když se nasadí nová verze nebo appka spadne.
  setInterval(syncHeader, 60_000);
  // AI kontrola je dražší (volá Anthropic), stačí řidčeji.
  setInterval(syncAi, 5 * 60_000);
}

/* ---------- soubory: drag & drop + rozpoznání typu ---------- */

/** Obsah načtených souborů — do textarey se nesype, zůstane jen jmenovka. */
const loaded = { revolut: null, historyCsv: null, prevXml: null };

/** Co poslat na server: přednost má načtený soubor, jinak ručně vložený text. */
function inputValue(target) {
  return loaded[target]?.text ?? $(target).value;
}

async function loadFiles(files, fallbackTarget) {
  const placed = [];

  for (const file of files) {
    const text = await file.text();
    const detected = detectKind(text, file.name);
    // Rozpoznaný typ vyhrává, ale jen když pro něj pole existuje.
    const target = detected && detected in loaded ? detected : fallbackTarget;
    if (!target || !(target in loaded)) continue;

    loaded[target] = { name: file.name, size: file.size, text };
    $(target).value = '';
    renderZone(target);
    placed.push({ file: file.name, target, moved: Boolean(detected) && detected !== fallbackTarget });
  }

  if (placed.length === 0) return;
  const moved = placed.filter((p) => p.moved);
  showMessage(
    placed.map((p) => `${p.file} → ${t[fieldKey(p.target)]}`).join(' · '),
    moved.length ? 'warn' : 'ok',
  );
}

function renderZone(target) {
  const zone = document.querySelector(`[data-drop="${target}"]`);
  const chips = zone.querySelector('.chips');
  const textarea = $(target);
  const info = loaded[target];

  if (!info) {
    chips.innerHTML = '';
    textarea.classList.remove('hidden');
    return;
  }

  const lines = info.text.split(/\r?\n/).filter((l) => l.trim() !== '').length;
  textarea.classList.add('hidden');
  chips.innerHTML = `
    <span class="chip" title="${escapeHtml(info.name)}">
      <span class="ico">📄</span>
      <span class="name">${escapeHtml(info.name)}</span>
      <span class="dim">${fmtSize(info.size)} · ${t.lines(lines)}</span>
      <button class="x" type="button" title="${escapeHtml(t.removeFile)}">✕</button>
    </span>`;
  chips.querySelector('.x').addEventListener('click', () => {
    loaded[target] = null;
    renderZone(target);
  });
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fieldKey(target) {
  return { revolut: 'revolut', historyCsv: 'history', prevXml: 'prevXml' }[target] ?? target;
}

function setupDropZones() {
  // Bez toho prohlížeč soubor prostě otevře místo předání stránce.
  for (const type of ['dragover', 'drop']) {
    document.addEventListener(type, (e) => e.preventDefault());
  }

  for (const zone of document.querySelectorAll('[data-drop]')) {
    const target = zone.dataset.drop;

    zone.addEventListener('dragenter', () => zone.classList.add('dragover'));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('dragover');

      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) { await loadFiles(files, target); return; }

      // Přetažený text (např. výběr z internetového bankovnictví).
      const text = e.dataTransfer?.getData('text/plain');
      if (text) {
        const dest = detectKind(text) ?? target;
        loaded[dest] = null;
        renderZone(dest);
        $(dest).value = text;
      }
    });
  }
}

/* ---------- start ---------- */

function init() {
  $('date').value = new Date().toISOString().slice(0, 10);
  $('lang').value = lang;

  $('lang').addEventListener('change', (e) => { lang = e.target.value; applyLang(); });
  $('process').addEventListener('click', process);
  $('generate').addEventListener('click', generate);
  $('clear').addEventListener('click', () => {
    for (const id of TEXTAREAS) {
      $(id).value = '';
      loaded[id] = null;
      renderZone(id);
    }
    rows = [];
    showMessage('');
    render();
  });

  // Nejčastější případ: rozúčtovává se minulý měsíc celý.
  $('lastMonth').addEventListener('click', () => {
    const due = $('date').value ? new Date(`${$('date').value}T00:00:00`) : new Date();
    const from = new Date(due.getFullYear(), due.getMonth() - 1, 1);
    const to = new Date(due.getFullYear(), due.getMonth(), 0);
    $('dateFrom').value = isoDate(from);
    $('dateTo').value = isoDate(to);
  });

  for (const id of FILTER_IDS) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  }
  $('clearFilters').addEventListener('click', clearFilters);

  for (const input of document.querySelectorAll('input[type="file"][data-target]')) {
    input.addEventListener('change', async (e) => {
      await loadFiles([...(e.target.files ?? [])], e.target.dataset.target);
      e.target.value = ''; // ať jde tentýž soubor vybrat znovu
    });
  }

  setupTabs();
  setupDropZones();
  setupBulk();
  setupTemplate();
  setupExport();
  setupHistory();
  $('date').addEventListener('change', updateTplSummary);

  startHeaderClock();
  applyLang();
}

init();
