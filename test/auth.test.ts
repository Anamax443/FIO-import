import { describe, expect, it } from 'vitest';
import { authorize } from '../src/auth.js';

const req = (headers: Record<string, string> = {}) =>
  new Request('https://example.workers.dev/api/process', { headers });

describe('brána k /api/*', () => {
  it('bez konfigurace nepustí nikoho (fail-closed)', async () => {
    const r = await authorize(req(), {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.error).toContain('bránu');
    }
  });

  it('správný token pustí', async () => {
    const r = await authorize(req({ 'x-app-token': 'tajne' }), { APP_TOKEN: 'tajne' });
    expect(r).toEqual({ ok: true, via: 'token' });
  });

  it('špatný nebo chybějící token nepustí', async () => {
    const cases: Record<string, string>[] = [{}, { 'x-app-token': 'spatne' }, { 'x-app-token': 'tajn' }];
    for (const headers of cases) {
      const r = await authorize(req(headers), { APP_TOKEN: 'tajne' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
  });

  it('při zapnutém Accessu nepustí podvržený ani prázdný JWT', async () => {
    const env = { ACCESS_TEAM_DOMAIN: 'tym', ACCESS_AUD: 'aud123' };
    for (const jwt of ['', 'neco.divneho', 'a.b.c']) {
      const r = await authorize(req({ 'cf-access-jwt-assertion': jwt }), env);
      expect(r.ok).toBe(false);
    }
  });

  it('token funguje i vedle zapnutého Accessu (záložní cesta)', async () => {
    const r = await authorize(req({ 'x-app-token': 'tajne' }), {
      ACCESS_TEAM_DOMAIN: 'tym', ACCESS_AUD: 'aud123', APP_TOKEN: 'tajne',
    });
    expect(r).toEqual({ ok: true, via: 'token' });
  });
});
