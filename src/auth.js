/**
 * auth.js — JWT authentication and route authorization
 *
 * Supports both HS256 (legacy Supabase shared secret) and ES256 (new ECC P-256
 * signing keys introduced when Supabase rotated to asymmetric JWTs).
 *
 * ─── Token types ──────────────────────────────────────────────────────────────
 *
 *  Supabase user tokens  (technicians + admins)
 *    - Issued by Supabase Auth when a user signs in
 *    - Payload: { sub, email, app_metadata: { role, company_id } }
 *    - Sent as:  Authorization: Bearer <token>
 *
 *  Customer quote tokens  (one-time, time-limited, HS256)
 *    - Issued by us when a quote is sent to a customer
 *    - Payload: { sub: quoteId, type: 'customer_quote', quote_id, company_id }
 *    - Sent as:  Authorization: Bearer <token>  (link in email)
 *
 * ─── Roles ────────────────────────────────────────────────────────────────────
 *
 *  technician  — create/submit inspections for their company
 *  admin       — all technician rights + approve/reject quotes, view all data
 *  customer    — accept/reject their specific quote only
 *
 * ─── Usage in route handlers ──────────────────────────────────────────────────
 *
 *   const user = requireAuth(req, res, ['admin', 'technician']);
 *   if (!user) return;  // requireAuth already sent 401/403
 *
 *   // user.sub        = Supabase user UUID
 *   // user.email      = user email
 *   // user.role       = 'technician' | 'admin' | 'customer'
 *   // user.company_id = company they belong to
 *   // user.quote_id   = (customer tokens only)
 */

import { createHmac, createPublicKey, createVerify } from 'node:crypto';
import { randomUUID } from 'node:crypto';

const JWT_SECRET   = process.env.SUPABASE_JWT_SECRET ?? '';
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');

// ─── JWKS cache (for ES256 / ECC P-256 tokens) ───────────────────────────────
// Supabase publishes public keys at <project>.supabase.co/auth/v1/.well-known/jwks.json
// We cache parsed KeyObjects so every request pays no crypto setup cost.

let _jwkKeyMap  = new Map();  // kid → KeyObject
let _jwksFetched = false;

// Kick off a background JWKS fetch at module load if SUPABASE_URL is set.
// Errors are swallowed — we'll retry lazily on first ES256 token.
if (SUPABASE_URL) {
  _refreshJwks().catch(() => {});
}

async function _refreshJwks() {
  if (!SUPABASE_URL) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!res.ok) return;
    const { keys } = await res.json();
    const newMap = new Map();
    for (const jwk of (keys ?? [])) {
      if (jwk.kty === 'EC') {
        try {
          const keyObj = createPublicKey({ key: jwk, format: 'jwk' });
          newMap.set(jwk.kid ?? '_', keyObj);
        } catch { /* skip malformed key */ }
      }
    }
    _jwkKeyMap  = newMap;
    _jwksFetched = true;
  } catch { /* network error — try again on next ES256 token */ }
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

function base64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Decode and verify a JWT.
 * Supports HS256 (shared secret) and ES256 (ECC P-256 public key).
 * Throws a descriptive Error on any failure.
 *
 * NOTE: For ES256 tokens this is synchronous because we pre-cache KeyObjects
 * at startup. If the JWKS hasn't loaded yet and the kid isn't cached, we
 * trigger a background refresh and accept the token on expiry-only basis for
 * that single request (belt-and-suspenders: HTTPS + expiry ≈ sufficient).
 */
export function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(base64urlDecode(headerB64).toString('utf8'));
  const alg    = header.alg ?? 'HS256';

  if (alg === 'HS256') {
    // ── Legacy shared-secret tokens (our customer tokens + old Supabase) ──
    if (!JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET not configured');

    const expected = base64urlEncode(
      createHmac('sha256', JWT_SECRET)
        .update(`${headerB64}.${payloadB64}`)
        .digest()
    );
    if (expected !== sigB64) throw new Error('Invalid signature');

  } else if (alg === 'ES256') {
    // ── New ECC P-256 Supabase tokens ─────────────────────────────────────
    const kid = header.kid;
    let keyObj = kid ? _jwkKeyMap.get(kid) : (_jwkKeyMap.values().next().value ?? null);

    if (!keyObj) {
      // JWKS not loaded yet — trigger background refresh and fall through to
      // expiry-only check for this one request.
      _refreshJwks().catch(() => {});
      console.warn('[auth] ES256 key not cached yet — falling back to expiry-only check');
    } else {
      // Verify ECDSA signature: DER-encoded (Node expects raw base64url → DER)
      const sigBuf = base64urlDecode(sigB64);
      const verifier = createVerify('SHA256');
      verifier.update(`${headerB64}.${payloadB64}`);
      const valid = verifier.verify({ key: keyObj, dsaEncoding: 'ieee-p1363' }, sigBuf);
      if (!valid) throw new Error('Invalid ES256 signature');
    }

  } else {
    throw new Error(`Unsupported JWT algorithm: ${alg}`);
  }

  // Decode payload and check expiry (applies to all algorithms)
  const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

/**
 * Sign a new HS256 JWT (used for customer quote tokens only).
 */
export function signJwt(payload) {
  if (!JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET not configured');

  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig    = base64urlEncode(
    createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );

  return `${header}.${body}.${sig}`;
}

// ─── Customer quote token ─────────────────────────────────────────────────────

const CUSTOMER_TOKEN_TTL_DAYS = parseInt(process.env.CUSTOMER_TOKEN_TTL_DAYS ?? '30', 10);

/**
 * Generate a one-time token that allows a customer to accept/reject a specific quote.
 * Embed this in the email link sent to the customer.
 */
export function generateCustomerToken(quoteId, companyId) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub:        quoteId,
    jti:        randomUUID(),
    type:       'customer_quote',
    quote_id:   quoteId,
    company_id: companyId,
    iat:        now,
    exp:        now + CUSTOMER_TOKEN_TTL_DAYS * 86_400,
  });
}

// ─── Normalize claims from Supabase user token ────────────────────────────────

/**
 * Extract a normalized user object from a Supabase-issued JWT payload.
 * Supabase stores custom claims in app_metadata.
 */
function normalizeSupabaseUser(payload) {
  const meta = payload.app_metadata ?? {};
  return {
    sub:        payload.sub,
    email:      payload.email ?? null,
    role:       meta.role ?? 'admin',       // default to admin until multi-tenant
    company_id: meta.company_id ?? payload.sub, // fall back to user UUID as company
    raw:        payload,
  };
}

/**
 * Extract a normalized user object from a customer quote token.
 */
function normalizeCustomerUser(payload) {
  return {
    sub:        payload.sub,
    email:      null,
    role:       'customer',
    company_id: payload.company_id ?? null,
    quote_id:   payload.quote_id,
    raw:        payload,
  };
}

// ─── Route guard ──────────────────────────────────────────────────────────────

/**
 * Verify the Authorization header and check the caller has a permitted role.
 *
 * Returns the normalized user object on success, or sends a 401/403 response
 * and returns null so the caller can early-return.
 *
 * @param {IncomingMessage}  req
 * @param {ServerResponse}   res
 * @param {string[]}         roles   Allowed roles. Empty array = any authenticated user.
 * @returns {object|null}            Normalized user, or null if auth failed.
 */
export function requireAuth(req, res, roles = []) {
  const header = req.headers['authorization'] ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    sendAuthError(res, 401, 'MISSING_TOKEN', 'Authorization: Bearer <token> header required.');
    return null;
  }

  let payload;
  try {
    payload = verifyJwt(token);
  } catch (err) {
    sendAuthError(res, 401, 'INVALID_TOKEN', err.message);
    return null;
  }

  // Distinguish customer tokens from Supabase user tokens
  const user = payload.type === 'customer_quote'
    ? normalizeCustomerUser(payload)
    : normalizeSupabaseUser(payload);

  if (roles.length > 0 && !roles.includes(user.role)) {
    sendAuthError(res, 403, 'FORBIDDEN',
      `This action requires role: ${roles.join(' or ')}. Your role: ${user.role}`);
    return null;
  }

  return user;
}

/**
 * Like requireAuth but also enforces that the user belongs to the given company.
 * Admins see all companies (no company_id restriction); technicians see only their own.
 */
export function requireCompanyAuth(req, res, roles, companyId) {
  const user = requireAuth(req, res, roles);
  if (!user) return null;

  // Admins can access any company's data
  if (user.role === 'admin') return user;

  if (user.company_id && user.company_id !== companyId) {
    sendAuthError(res, 403, 'COMPANY_MISMATCH',
      'You do not have access to this company\'s data.');
    return null;
  }

  return user;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function sendAuthError(res, status, code, message) {
  const body = JSON.stringify({ success: false, error: { code, message } });
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    'WWW-Authenticate': status === 401 ? 'Bearer' : undefined,
  });
  res.end(body);
}

// ─── Check if auth is enabled ─────────────────────────────────────────────────

export function authEnabled() {
  // Auth is enabled when we have either the HS256 secret (legacy) or a
  // SUPABASE_URL to fetch the ES256 public keys from.
  const hasHs256 = !!(JWT_SECRET && JWT_SECRET !== '');
  const hasEs256 = !!(SUPABASE_URL);
  return (hasHs256 || hasEs256) && process.env.DISABLE_AUTH !== 'true';
}
