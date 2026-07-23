import { describe, expect, it } from 'vitest';
import { buildDocHtml } from '../public/doc.js';

const SECTIONS = [
  { h: 'Vrstvy dokumentace', p: 'SPEC.md, ARCHITECTURE.md, BUILD.md a další.' },
  { h: 'AI & <tag>', p: 'Text s & a <b> uvnitř.' },
];

const LABELS = {
  docTitle: 'FIO-import — dokumentace',
  subtitle: 'výpisy → XML pro Fio',
  generatedAt: 'vygenerováno',
  version: 'verze',
  footer: 'Zdrojem pravdy je repozitář.',
};

const META = { lang: 'cs', now: '23.7.2026 05:46', commit: 'abc123', url: 'https://fio-import.example' };

describe('buildDocHtml', () => {
  const html = buildDocHtml(SECTIONS, META, LABELS);

  it('je samostatné, tisknutelné HTML s metadaty', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@media print');
    expect(html).toContain('abc123');                    // verze
    expect(html).toContain('https://fio-import.example'); // odkaz na běžící appku
    expect(html).toContain('Vrstvy dokumentace');
    expect(html).toContain('Zdrojem pravdy je repozitář.');
  });

  it('escapuje < > & v nadpisu i textu', () => {
    expect(html).toContain('AI &amp; &lt;tag&gt;');
    expect(html).toContain('Text s &amp; a &lt;b&gt; uvnitř.');
  });

  it('bez url metadata nespadne', () => {
    const h = buildDocHtml(SECTIONS, { ...META, url: '' }, LABELS);
    expect(h.startsWith('<!doctype html>')).toBe(true);
    expect(h).not.toContain('fio-import.example');
  });
});
