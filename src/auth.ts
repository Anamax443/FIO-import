/**
 * Přístup k `/api/*`. Aplikace pracuje s čísly účtů, adresou a útratami,
 * takže je **fail-closed**: bez nakonfigurované brány API nic nepustí.
 *
 * Dvě varianty, lze kombinovat:
 *   1. **Cloudflare Access** (doporučené) — přihlášení e-mailem přes Zero Trust.
 *      Worker navíc sám ověří podpis JWT, takže obejít Access přímým voláním
 *      *.workers.dev nejde. Zapne se nastavením ACCESS_TEAM_DOMAIN + ACCESS_AUD.
 *   2. **Sdílený token** — hlavička `x-app-token` proti secretu APP_TOKEN.
 *      Rychlá pojistka, než je Access hotový.
 */

export interface AuthEnv {
  APP_TOKEN?: string;
  /** Např. `mojefirma` pro mojefirma.cloudflareaccess.com. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag z Access aplikace. */
  ACCESS_AUD?: string;
}

export type AuthResult = { ok: true; via: 'access' | 'token' } | { ok: false; status: 401 | 503; error: string };

export async function authorize(request: Request, env: AuthEnv): Promise<AuthResult> {
  const accessConfigured = Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

  if (!accessConfigured && !env.APP_TOKEN) {
    return {
      ok: false,
      status: 503,
      error: 'Aplikace nemá nastavenou bránu. Nastav Cloudflare Access (ACCESS_TEAM_DOMAIN + ACCESS_AUD) nebo secret APP_TOKEN — viz docs/BUILD.md.',
    };
  }

  if (accessConfigured) {
    const jwt = request.headers.get('cf-access-jwt-assertion')
      ?? cookieValue(request.headers.get('cookie'), 'CF_Authorization');
    if (jwt && await verifyAccessJwt(jwt, env.ACCESS_TEAM_DOMAIN!, env.ACCESS_AUD!)) {
      return { ok: true, via: 'access' };
    }
  }

  if (env.APP_TOKEN) {
    const provided = request.headers.get('x-app-token');
    if (provided && timingSafeEqual(provided, env.APP_TOKEN)) return { ok: true, via: 'token' };
  }

  return { ok: false, status: 401, error: 'Nepřihlášeno.' };
}

/* ---------- Cloudflare Access JWT ---------- */

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function verifyAccessJwt(jwt: string, teamDomain: string, aud: string): Promise<boolean> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return false;

  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; nbf?: number; iss?: string };
  try {
    header = JSON.parse(decodeB64Url(headerB64));
    payload = JSON.parse(decodeB64Url(payloadB64));
  } catch {
    return false;
  }

  if (header.alg !== 'RS256' || !header.kid) return false;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return false;

  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(aud)) return false;

  const issuer = `https://${teamDomain}.cloudflareaccess.com`;
  if (payload.iss !== issuer) return false;

  const jwk = (await loadJwks(issuer)).find((k) => k.kid === header.kid);
  if (!jwk) return false;

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
}

async function loadJwks(issuer: string): Promise<Jwk[]> {
  const cached = jwksCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) return cached?.keys ?? [];

  const data = (await res.json()) as { keys?: Jwk[] };
  const keys = data.keys ?? [];
  jwksCache.set(issuer, { keys, fetchedAt: Date.now() });
  return keys;
}

/* ---------- pomocné ---------- */

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}

function b64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeB64Url(s: string): string {
  return new TextDecoder().decode(b64UrlToBytes(s));
}

/** Porovnání nezávislé na délce shodného prefixu. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
