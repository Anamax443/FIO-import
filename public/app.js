import { detectKind } from './detect.js';
import { STRINGS } from './i18n.js';

const $ = (id) => document.getElementById(id);
const TEXTAREAS = ['fio', 'revolut', 'historyCsv', 'prevXml'];

let lang = localStorage.getItem('fio-lang') || 'cs';
let t = STRINGS[lang];
let rows = [];
let report = { new: 0, alreadyClaimed: 0, duplicateInBatch: 0 };

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
  tickClock();
  render();
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

function fmt(n) {
  return new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-US', { minimumFractionDigits: 2 }).format(n);
}

/* ---------- render tabulky ---------- */

function visibleRows() {
  const src = $('fSource').value;
  const status = $('fStatus').value;
  const mandatoryOnly = $('fMandatory').checked;
  return rows.filter((r) =>
    (!src || r.source === src) &&
    (!status || r.status === status) &&
    (!mandatoryOnly || r.mandatory));
}

function render() {
  const tbody = $('rows');
  const list = visibleRows();

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--fg-dim)">${escapeHtml(t.noRows)}</td></tr>`;
  } else {
    tbody.innerHTML = list.map(rowHtml).join('');
    bindRowEvents();
  }
  updateSummary();
}

function rowHtml(r) {
  const cls = [r.include ? '' : 'excluded', r.mandatory ? 'mandatory' : ''].filter(Boolean).join(' ');
  const source = r.source === 'pravidelna' ? (lang === 'cs' ? 'pravidelná' : 'recurring') : r.source;
  return `
    <tr class="${cls}" data-id="${escapeHtml(r.id)}">
      <td class="keep"><input type="checkbox" class="inc" ${r.include ? 'checked' : ''} title="${escapeHtml(t.includeTip)}"></td>
      <td class="keep"><span class="badge src">${escapeHtml(source)}</span></td>
      <td class="keep"><span class="badge ${r.status}">${r.status}</span></td>
      <td>${escapeHtml(r.date_txn ?? '')}</td>
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
  $('sumDup').textContent = rows.filter((r) => r.status === 'DUPLICATE_IN_BATCH').length;
  $('generate').disabled = active.length === 0;
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
        fio: $('fio').value,
        revolut: $('revolut').value,
        historyCsv: $('historyCsv').value,
        prevXml: $('prevXml').value,
        useAi: $('useAi').checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    rows = data.rows;
    report = data.report;
    render();

    const notes = [t.historyInfo(data.historySize)];
    if (!data.aiUsed) notes.push(t.aiOff);
    showMessage(notes.join(' '), 'ok');
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

function startHeaderClock() {
  syncHeader();
  tickClock();
  setInterval(tickClock, 1000);
  // Přesync: srovná drift hodin a ukáže, když se nasadí nová verze nebo appka spadne.
  setInterval(syncHeader, 60_000);
}

/* ---------- soubory: drag & drop + rozpoznání typu ---------- */

async function loadFiles(files, fallbackTarget) {
  const placed = [];

  for (const file of files) {
    const text = await file.text();
    const detected = detectKind(text, file.name);
    const target = detected ?? fallbackTarget;
    if (!target || !$(target)) continue;

    $(target).value = text;
    placed.push({ file: file.name, target, moved: Boolean(detected) && detected !== fallbackTarget });
  }

  if (placed.length === 0) return;
  const moved = placed.filter((p) => p.moved);
  showMessage(
    placed.map((p) => `${p.file} → ${t[fieldKey(p.target)]}`).join(' · '),
    moved.length ? 'warn' : 'ok',
  );
}

function fieldKey(target) {
  return { fio: 'fio', revolut: 'revolut', historyCsv: 'history', prevXml: 'prevXml' }[target] ?? target;
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
      if (text) $(detectKind(text) ?? target).value = text;
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
    for (const id of TEXTAREAS) $(id).value = '';
    rows = [];
    showMessage('');
    render();
  });

  for (const el of ['fSource', 'fStatus', 'fMandatory']) $(el).addEventListener('change', render);

  for (const input of document.querySelectorAll('input[type="file"][data-target]')) {
    input.addEventListener('change', async (e) => {
      await loadFiles([...(e.target.files ?? [])], e.target.dataset.target);
      e.target.value = ''; // ať jde tentýž soubor vybrat znovu
    });
  }

  setupDropZones();

  startHeaderClock();
  applyLang();
}

init();
