# Fire Flow — Privacy-First Architecture Plan

> Current status: solid foundation with targeted gaps. This document classifies every data
> type, maps the threat model, and gives a phased implementation plan ordered by risk.

---

## 1. Data Inventory & Classification

| Data | Where stored | Sensitivity | Currently encrypted |
|---|---|---|---|
| Property address, contact, phone | Supabase `inspections` | Medium | ✗ No |
| Inspection photos (base64) | Supabase `inspections.images` | High | ✗ No |
| Voice/AI transcripts | Supabase `inspections` | High | ✗ No |
| Deficiency details | Supabase `inspections` | Medium | ✗ No |
| Customer email | Supabase `quotes` | High | ✗ No |
| Quote line items + totals | Supabase `quotes` | Medium | ✗ No |
| Customer quote tokens | Supabase `quotes.customer_token` | High | ✗ No |
| Stripe customer / subscription IDs | Supabase `companies` | Low | ✗ No |
| Admin passwords | Supabase Auth | High | ✓ Supabase-managed |
| Session JWTs | Browser `sessionStorage` | High | ✓ HTTPS in transit |
| Company branding/settings | Supabase `companies` | Low | ✗ No |

---

## 2. Threat Model

### What we're protecting against

| Threat | Example | Impact |
|---|---|---|
| Cross-company data leak | Company A admin reads Company B's inspections | Critical |
| Privilege escalation | Technician creates inspections for another company | High |
| Token theft | Customer quote link forwarded to wrong recipient | Medium |
| Database breach | Supabase/backup exposure | High |
| Log exposure | PII appearing in Railway log drain | Medium |
| MITM | Unencrypted data in transit | Low (HTTPS via Railway) |
| Retained data | Old inspection photos sitting in DB for years | Medium |

### What we're explicitly NOT responsible for
- Supabase infrastructure security (covered by Supabase's SOC 2)
- Stripe PCI compliance (covered by Stripe)
- Railway infrastructure (TLS termination, DDoS)

---

## 3. Current Security Posture

### ✅ Already correct
- Company ID filter applied to all list endpoints (inspections, jobs, quotes)
- Customer tokens scoped to a single quote — cannot access anything else
- Role-based access: technician / admin / customer roles enforced on every route
- Stripe webhooks signature-verified before processing
- Rate limiting on all write endpoints (60 req/min)
- JWKS-based JWT verification (ES256 + HS256)
- Passwords never logged; Supabase manages password hashing

### ❌ Gaps that need fixing (ordered by risk)

#### CRITICAL
1. **No company_id ownership check on `POST /v1/inspection`**
   A technician can supply any `company_id` in the request body and create an inspection for
   a company they don't belong to. Fix: validate `req.user.company_id === body.company_id`.

2. **No company_id ownership check on `POST /v1/quote`**
   Same as above for admin creating quotes. Fix: ignore the `company_id` from the body
   entirely — always use `req.user.company_id`.

3. **Customer quote token stored plaintext in the database**
   If the quotes table is exported or leaked, every live customer link is immediately valid.
   Fix: store a HMAC of the token's `jti` claim instead of the full token.

#### HIGH
4. **Inspection photos stored as inline base64 in the database**
   Every SQL backup or table export exposes raw photos. Fix: store to a cloud bucket with
   pre-signed URLs; keep only the URL in the database.

5. **Customer token embedded in URL**
   URLs appear in browser history, server access logs, email client prefetch, referrer headers.
   Fix: serve the token via a one-time redirect through a server-side lookup key.

6. **`X-Forwarded-Proto` trusted without `TRUST_PROXY` check**
   Customer links can be silently downgraded to `http://`. Fix: gate the proto header read
   behind the same `TRUST_PROXY` flag already used for IP.

7. **PII (email) logged in dev mode signup path**
   `console.log` at `server.js:584` prints signup email to Railway logs. Fix: remove or
   replace with a count/flag.

#### MEDIUM
8. **No security response headers**
   Missing: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
   `Content-Security-Policy`. Fix: add a `setSecurityHeaders()` helper called on every response.

9. **No data retention policy**
   Inspections and their photos are kept indefinitely. Regulations (PIPEDA, GDPR) require a
   defined retention period. Fix: add a `retention_expires_at` field and a periodic cleanup job.

10. **No image upload size or MIME validation**
    Unbounded base64 blobs can exhaust the database. Fix: enforce `MAX_IMAGE_BYTES` (5 MB)
    and validate MIME type server-side before accepting.

11. **`X-Powered-By` header reveals framework name**
    Minor information disclosure. Fix: remove or replace with a generic value.

---

## 4. Implementation Plan

Changes are ordered: quick-win fixes first, then architectural improvements, then policy work.

---

### Phase 1 — Close the Critical Gaps (1–2 days)

#### 1.1 Enforce company ownership on write endpoints

**File:** `src/server.js`

```js
// POST /v1/inspection — always stamp the user's company_id, never trust body
function handleCreateInspection(req, res, body, user) {
  const company_id = user.company_id;  // ignore body.company_id
  // ...rest unchanged
}

// POST /v1/quote — same
function handleCreateQuote(req, res, body, user) {
  const company_id = user.company_id;
  // ...rest unchanged
}
```

Also validate individual record access (`GET /v1/inspection/:id`,
`GET /v1/quote/:id` in admin role) checks `inspection.company_id === user.company_id`.

---

#### 1.2 Hash the customer token before persisting

**File:** `src/server.js`, `src/auth.js`

Store a SHA-256 hash of the token's `jti` in the database rather than the full JWT.
On `POST /v1/quote/:id/accept` and related endpoints, verify the hash matches.

```js
import { createHash } from 'node:crypto';

function hashToken(jti) {
  return createHash('sha256').update(jti).digest('hex');
}

// On send:
quote.customer_token_hash = hashToken(payload.jti);
// (do NOT store the full token)

// On verify:
const { jti } = verifyJwt(token);  // already verified signature
if (quote.customer_token_hash !== hashToken(jti)) throw new Error('Token revoked');
```

This means a leaked database export cannot be used to send fake approvals.

---

#### 1.3 Remove PII from logs

**File:** `src/server.js`

```js
// Before (line ~584):
console.log(`[SIGNUP DEV] Would create admin account for ${email}...`);

// After:
console.log(`[SIGNUP DEV] Would create admin account (dev mode, email redacted)`);
```

Audit all other `console.log` calls — confirm no `email`, `phone`, `address`, or
`customer_email` fields are interpolated into log strings.

---

#### 1.4 Fix `X-Forwarded-Proto` gate

**File:** `src/server.js`

```js
// Before (lines 259, 307, 897):
const proto = req.headers['x-forwarded-proto'] ?? 'http';

// After:
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const proto = (TRUST_PROXY && req.headers['x-forwarded-proto']) ? req.headers['x-forwarded-proto'] : 'https';
// Default to https in production — Railway always terminates TLS.
```

---

### Phase 2 — Security Headers & Input Validation (1 day)

#### 2.1 Add security response headers

**File:** `src/server.js`

```js
function setSecurityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // Remove framework fingerprint
  res.removeHeader('X-Powered-By');
  // Content-Security-Policy — tighten after frontend audit
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co https://api.stripe.com"
  );
}
// Call at the top of the request handler, before routing.
```

---

#### 2.2 Enforce image upload limits

**File:** `src/server.js` (image upload handler)

```js
const MAX_IMAGE_BYTES = parseInt(process.env.MAX_IMAGE_BYTES ?? String(5 * 1024 * 1024), 10);
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function validateImage(imageObj) {
  if (!imageObj?.data) throw Object.assign(new Error('No image data'), { status: 400 });

  // Check MIME type from data URI prefix
  const mimeMatch = imageObj.data.match(/^data:([^;]+);base64,/);
  if (!mimeMatch || !ALLOWED_IMAGE_TYPES.has(mimeMatch[1])) {
    throw Object.assign(new Error('Invalid image type — JPEG, PNG, WebP, GIF only'), { status: 415 });
  }

  // Check size (base64 is ~4/3 of raw bytes)
  const base64Data = imageObj.data.replace(/^data:[^;]+;base64,/, '');
  const approxBytes = Math.ceil(base64Data.length * 0.75);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error(`Image too large (max ${MAX_IMAGE_BYTES / (1024*1024)} MB)`), { status: 413 });
  }
}
```

---

### Phase 3 — Token & Data Architecture (2–3 days)

#### 3.1 Move customer tokens off the URL

**Current flow:** `/customer-quote?token=<jwt>`

**New flow:**

1. On `POST /v1/quote/:id/send`, generate the JWT as today, but:
   - Store `token_hash` (not the token) in the DB
   - Generate a short opaque `link_id` (16 random bytes, hex-encoded)
   - Store `{ link_id → { quote_id, token_jti, expires_at } }` in a `linkStore`

2. Customer receives URL: `/q/<link_id>` (no token in URL)

3. `GET /q/<link_id>` server route:
   - Looks up `link_id` in `linkStore`
   - Validates it hasn't expired
   - Issues the token as an `HttpOnly` short-lived session cookie (or returns it in response body for SPA flow)
   - Marks `link_id` as consumed (one-time use for the initial exchange)

**Why this is better:**
- URL is opaque — forwarding the link to the wrong person is now a conscious act, not an accident
- Browser history, server logs, referrer headers never contain the credential
- Optional: implement "link accessed" notification to the admin

---

#### 3.2 Externalize inspection photo storage

**Current:** Base64 blob inside the `images` JSONB field in Supabase.

**Target:** Supabase Storage (or S3) with server-signed URLs.

**Migration path:**

1. On upload (`POST /v1/inspection/:id/image`):
   - Decode base64 → binary buffer
   - Validate MIME + size (Phase 2.2)
   - Upload to `supabase.storage.from('inspection-photos').upload(path, buffer)`
   - Store only the storage path in the DB: `{ id, path, context, processed: false }`

2. On read (`GET /v1/inspection/:id`):
   - For each image, generate a signed URL (15-minute expiry) via Supabase Storage
   - Return `{ ..., signedUrl: '...' }` instead of raw base64

3. **Access control:** Use Supabase Storage RLS policies — only service role (server) can read/write.
   Clients receive signed URLs that expire, not permanent public links.

**Supabase Storage setup:**
```sql
-- In Supabase SQL editor:
-- 1. Create bucket (private, no public access)
insert into storage.buckets (id, name, public) values ('inspection-photos', 'inspection-photos', false);

-- 2. RLS: only service role can insert
create policy "service_role_only" on storage.objects
  for all using (auth.role() = 'service_role');
```

---

### Phase 4 — Data Retention Policy (1 day)

#### 4.1 Add retention timestamps

Add `retention_expires_at` to every entity on creation:

```js
// Default: inspections expire after 7 years (Canadian fire code minimum)
const INSPECTION_RETENTION_DAYS = parseInt(process.env.INSPECTION_RETENTION_DAYS ?? '2555', 10);
const QUOTE_RETENTION_DAYS      = parseInt(process.env.QUOTE_RETENTION_DAYS      ?? '365',  10);
const JOB_RETENTION_DAYS        = parseInt(process.env.JOB_RETENTION_DAYS        ?? '365',  10);

function retentionDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
```

#### 4.2 Scheduled cleanup job

A lightweight scheduled task (Railway Cron or a setInterval in server.js) that runs nightly:

```js
// Pseudo-code for cleanup worker
async function runRetentionCleanup() {
  const now = new Date().toISOString();
  let purged = 0;
  for (const [id, insp] of inspectionStore) {
    if (insp.retention_expires_at && insp.retention_expires_at < now) {
      // Delete photos from storage first
      await deleteInspectionPhotos(insp);
      inspectionStore.delete(id);
      await deleteById('inspections', id);
      purged++;
    }
  }
  if (purged) console.log(`[RETENTION] Purged ${purged} expired inspections`);
}
```

---

### Phase 5 — Minimal Data Collection Review (ongoing)

#### 5.1 Audit every field we collect

For each field currently stored, ask:

| Field | Do we display it? | Do we process it? | Action |
|---|---|---|---|
| `phone` | Yes (quote PDF) | No | Keep — required for quotes |
| `voice_recordings` | Only during processing | AI transcription | Delete raw audio after transcription |
| `contact` | Yes (quote PDF) | No | Keep — required for quotes |
| `metadata.raw` | No | Debug only | Remove from production entities |
| `raw` on JWT payload | No | Debug | Remove from `normalizeSupabaseUser` return value in production |

#### 5.2 Strip raw JWT payload from normalized user

**File:** `src/auth.js`

```js
// Before:
return { sub, email, role, company_id, raw: payload };

// After:
return { sub, email, role, company_id };
// raw is not used anywhere in server.js — removes full JWT payload from memory
```

#### 5.3 Voice recordings: delete after transcription

Voice recordings have no business use after the AI generates a transcript. Once transcription
is complete (coordinator marks state `complete`), delete the raw audio blobs from the entity:

```js
// In coordinator.js, after successful transcription:
inspectionStore.set(id, {
  ...inspection,
  voice_recordings: [],     // clear blobs — transcript is in deficiencies array
  voice_purged_at: new Date().toISOString(),
});
```

---

## 5. Privacy Notice Requirements

Before accepting customers, the app must have:

1. **Privacy Policy** — what data is collected, why, how long it's kept, who it's shared with
   (Supabase/Stripe), how to request deletion.

2. **Data Processing Agreement (DPA)** — if serving Canadian or EU customers, a DPA with
   each sub-processor (Supabase, Stripe, Railway) is legally required.

3. **Right to erasure endpoint** — a `DELETE /v1/company` or admin-facing "Delete my data"
   action that purges all inspections, quotes, jobs, and the company record.

4. **Breach notification plan** — documented procedure for notifying users within 72 hours
   of a breach (PIPEDA / GDPR requirement).

---

## 6. Environment Variables Checklist

| Variable | Purpose | Required in prod |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | ✓ |
| `SUPABASE_JWT_SECRET` | Legacy HS256 JWT verify | ✓ |
| `SUPABASE_ANON_KEY` | Frontend auth | ✓ |
| `SUPABASE_SERVICE_KEY` | Server DB writes | ✓ |
| `STRIPE_SECRET_KEY` | Stripe API | ✓ |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verify | ✓ |
| `ALLOWED_ORIGIN` | CORS — set to app domain | ✓ |
| `TRUST_PROXY` | Trust X-Forwarded-* headers | ✓ (Railway) |
| `MAX_IMAGE_BYTES` | Upload size cap | Recommended (5242880) |
| `INSPECTION_RETENTION_DAYS` | Retention policy | Recommended (2555) |
| `CUSTOMER_TOKEN_TTL_DAYS` | Quote link expiry | Recommended (30) |

---

## 7. Prioritised Backlog

| # | Task | Effort | Risk if skipped |
|---|---|---|---|
| P1 | Fix company_id injection on write endpoints | 1 hr | Cross-tenant data write |
| P1 | Hash customer tokens before DB storage | 2 hrs | Token harvest from DB export |
| P1 | Remove email from dev logs | 15 min | PII in Railway logs |
| P1 | Fix X-Forwarded-Proto gate | 15 min | HTTP downgrade on customer links |
| P2 | Add security response headers | 1 hr | Browser-level exploits |
| P2 | Enforce image upload limits | 1 hr | DB exhaustion, no type safety |
| P3 | Move customer tokens off URL | 1 day | Token in browser history/logs |
| P3 | Externalize photos to Supabase Storage | 1 day | PII in DB exports |
| P4 | Add retention timestamps + cleanup job | 1 day | PIPEDA/GDPR compliance |
| P5 | Strip voice recordings post-transcription | 2 hrs | Unnecessary sensitive data retained |
| P5 | Remove `raw` JWT payload from user object | 15 min | Minimal data principle |
| P5 | Right-to-erasure endpoint | 2 hrs | Legal requirement for paid service |
