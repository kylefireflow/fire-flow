/**
 * auth.js — JWT authentication and route authorization
 *
 * Uses Node.js built-in crypto (no npm packages) to verify Supabase JWTs.
 * Supabase signs all tokens with HS256 using the JWT secret from:
 *   Settings → API → JWT Secret
 *
 * ─── Token types ──────────────────────────────────────────────────────────────
 *
 *  Supabase user tokens  (technicians + admins)
 *    - Issued by Supabase Auth when a user signs in
 *    - Payload: { sub, email, app_metadata: { role, company_id } }
 *    - Sent as:  Authorization: Bearer <token>
 *
 *  Customer quote tokens  (one-time, time-limited)
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

import { createHmac }  from 'node:crypto';
import { randomUUID }  from 'node:crypto';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? '';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function base64urlDecode(str) {
  // base64url → base64 → Buffer
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
 * Verify and decode a HS256 JWT.
 * Throws a descriptive error on any failure.
 */
export function verifyJwt(token) {
  if (!JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET not configured');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [headerB64, payloadB64, sigB64] = parts;

  // Verify signature
  const expected = base64urlEncode(
    createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest()
  );

  if (expected !== sigB64) throw new Error('Invalid signature');

  // Decode payload
  const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'));

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

/**
 * Sign a new HS256 JWT (used for customer quote tokens).
 */
export function signJwt(payload) {
  if (!JWT_SECRET) throw new Error('SUPABASE_JWT_SECRET not configured');

  const header  = base64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body    = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig     = base64urlEncode(
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
    role:       meta.role ?? 'technician',   // default to least privilege
    company_id: meta.company_id ?? null,
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
  return !!(JWT_SECRET && JWT_SECRET !== '' && process.env.DISABLE_AUTH !== 'true');
}
