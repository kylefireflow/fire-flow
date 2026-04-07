/**
 * server.js — REST API + SSE real-time stream for the Workflow Engine
 *
 * Routes
 * ──────
 *   POST   /v1/inspection                    Create inspection
 *   GET    /v1/inspection/:id                Get inspection
 *   GET    /v1/inspection/:id/report         HTML inspection report (print-to-PDF)
 *   GET    /v1/inspections                   List inspections (admin)
 *   POST   /v1/inspection/:id/recording      Add voice recording
 *   POST   /v1/inspection/:id/image          Add image
 *   POST   /v1/inspection/:id/submit         Submit for processing
 *
 *   POST   /v1/quote                         Create quote manually (admin)
 *   GET    /v1/quote/:id                     Get quote (admin or customer token)
 *   GET    /v1/quotes                        List quotes (admin)
 *   POST   /v1/quote/:id/send               Send quote to customer — returns signed link
 *   POST   /v1/quote/:id/approve             Admin approves quote (legacy)
 *   POST   /v1/quote/:id/reject              Admin rejects quote
 *   POST   /v1/quote/:id/accept              Customer accepts quote
 *   POST   /v1/quote/:id/customer-reject     Customer rejects quote
 *
 *   GET    /v1/job/:id                       Get job
 *   GET    /v1/jobs                          List jobs (?technician_id=&date=YYYY-MM-DD)
 *   POST   /v1/job/:id/start                 Dispatch job: scheduled → in_progress (tech)
 *   POST   /v1/job/:id/complete              Complete job: in_progress → completed (tech)
 *
 *   GET    /v1/stream                        SSE real-time event stream
 *   GET    /v1/queue/stats                   Queue statistics
 *   GET    /v1/queue/dlq                     Dead-letter queue contents
 *
 *   POST   /v1/auth/signup                  Create company account (public)
 *
 *   POST   /v1/billing/checkout             Create Stripe Checkout Session (admin)
 *   POST   /v1/billing/portal              Create Stripe Customer Portal session (admin)
 *   GET    /v1/billing/subscription        Get company subscription state (admin)
 *   POST   /v1/billing/webhook             Stripe webhook receiver (no auth — Stripe signed)
 *
 *   GET    /health
 *   GET    /ready
 */

import { createServer }       from 'node:http';
import { randomUUID }         from 'node:crypto';
import { readFile }           from 'node:fs/promises';
import { existsSync }         from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath }      from 'node:url';
import { bus, EventTypes }    from './events.js';
import { queues }             from './queue.js';
import {
  inspectionStore, quoteStore, jobStore, companyStore,
  createInspection, createQuote,
  InspectionMachine, QuoteMachine, JobMachine,
}                             from './state.js';
import {
  isStripeConfigured, createCheckoutSession, createBillingPortal,
  constructWebhookEvent, planFromPriceId, PLAN_DETAILS, createInvoiceItem,
}                             from './stripe.js';
import { generateInspectionReport } from './report.js';
import {
  submitInspection,
  approveQuote, acceptQuote, rejectQuote,
}                             from './coordinator.js';
import { ping, isConfigured } from './db.js';
import {
  requireAuth, requireCompanyAuth,
  generateCustomerToken, authEnabled,
} from './auth.js';

const __dirname      = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR     = resolve(__dirname, '../public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, urlPath) {
  // Prevent directory traversal
  let filePath = resolve(PUBLIC_DIR, '.' + urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  // Directory → index.html
  if (!extname(filePath)) filePath = join(filePath, 'index.html');
  if (!existsSync(filePath)) {
    // SPA fallback — serve index.html for all unknown paths
    filePath = join(PUBLIC_DIR, 'index.html');
    if (!existsSync(filePath)) { res.writeHead(404); return res.end('Not found'); }
  }
  try {
    const buf = await readFile(filePath);
    const ct  = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Content-Length': buf.length,
      'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  } catch (_) { res.writeHead(404); res.end('Not found'); }
}

const PORT           = parseInt(process.env.PORT          ?? '3003', 10);
const HOST           = process.env.HOST                   ?? '0.0.0.0';
const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES ?? '524288', 10); // 512 KB
const RATE_MAX       = parseInt(process.env.RATE_LIMIT_MAX ?? '60', 10);
const RATE_WIN_MS    = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10);
// BUG FIX: CORS — restrict to configured origin in production.
// Set ALLOWED_ORIGIN=https://app.example.com in .env; leave unset for permissive dev mode.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? null;
// BUG FIX: rate-limit X-Forwarded-For spoofing — only trust XFF header behind a known proxy.
const TRUST_PROXY    = process.env.TRUST_PROXY === 'true';
// BUG FIX: cap metadata array sizes to prevent DoS via huge payloads
const MAX_META_ARRAY = parseInt(process.env.MAX_META_ARRAY ?? '200', 10);

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const rlStore = new Map();
function isRateLimited(ip) {
  const now    = Date.now();
  const cutoff = now - RATE_WIN_MS;
  const times  = (rlStore.get(ip) ?? []).filter(t => t > cutoff);
  times.push(now);
  rlStore.set(ip, times);
  return times.length > RATE_MAX;
}

// ─── SSE clients ──────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(eventName, data) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

// Forward all bus events to SSE clients
bus.on('*', (event) => {
  broadcastSSE(event.type, event);
});

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        return reject(Object.assign(new Error(`Body > ${maxBytes} bytes`), { httpStatus: 413, code: 'PAYLOAD_TOO_LARGE' }));
      }
      chunks.push(chunk);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(json),
    'X-Powered-By':   'Fire Flow Workflow Engine',
  });
  res.end(json);
}

async function parseBody(req, res) {
  let raw;
  try { raw = await readBody(req, MAX_BODY_BYTES); }
  catch (err) {
    send(res, err.httpStatus ?? 400, { success: false, error: { code: err.code ?? 'READ_ERROR', message: err.message } });
    return null;
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch (_) {
    send(res, 400, { success: false, error: { code: 'INVALID_JSON', message: 'Body is not valid JSON.' } });
    return null;
  }
}

function getIp(req) {
  // BUG FIX: only trust X-Forwarded-For when running behind a known proxy (TRUST_PROXY=true).
  // Blindly taking [0] allows attackers to spoof any IP and bypass rate limiting.
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

// ─── Route handlers ───────────────────────────────────────────────────────────

// ─── Billing route handlers ───────────────────────────────────────────────────

// GET /v1/billing/subscription
function handleGetSubscription(req, res, user) {
  const company_id = user?.company_id ?? user?.sub ?? null;
  if (!company_id) {
    return send(res, 400, { success: false, error: { code: 'NO_COMPANY', message: 'User has no company_id.' } });
  }

  if (!isStripeConfigured()) {
    return send(res, 200, { success: true, data: {
      status:      'unconfigured',
      company_id,
      dev_mode:    true,
      message:     'Stripe is not configured. Set STRIPE_SECRET_KEY, STRIPE_STARTER_PRICE_ID, and STRIPE_COMPANY_PRICE_ID to enable billing.',
      env_vars:    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_STARTER_PRICE_ID', 'STRIPE_GROWTH_PRICE_ID', 'STRIPE_PRO_PRICE_ID'],
    }});
  }

  const company = companyStore.get(company_id);
  if (!company) {
    return send(res, 200, { success: true, data: {
      status:     'inactive',
      company_id,
      plan:        null,
      subscription_id: null,
      current_period_end: null,
    }});
  }
  return send(res, 200, { success: true, data: company });
}

// POST /v1/billing/checkout
async function handleCreateCheckout(req, res, user) {
  if (!isStripeConfigured()) {
    return send(res, 503, { success: false, error: {
      code: 'STRIPE_NOT_CONFIGURED',
      message: 'Stripe is not configured on this server. Set STRIPE_SECRET_KEY and price IDs.',
    }});
  }

  const body = await parseBody(req, res);
  if (body === null) return;

  const { plan, company_name } = body;
  const company_id     = user?.company_id ?? user?.sub ?? null;
  const customer_email = user?.email ?? null;

  if (!company_id) {
    return send(res, 400, { success: false, error: { code: 'NO_COMPANY', message: 'User has no company_id.' } });
  }

  // Build redirect URLs — use the request's Host header so it works on any domain
  const proto  = req.headers['x-forwarded-proto'] ?? 'http';
  const host   = req.headers['x-forwarded-host'] ?? req.headers['host'] ?? 'localhost:3003';
  const origin = `${proto}://${host}`;

  const existingCompany = companyStore.get(company_id);

  try {
    const { url, session_id } = await createCheckoutSession({
      company_id,
      company_name:    company_name ?? existingCompany?.company_name ?? '',
      customer_email,
      plan:            plan ?? 'starter',
      success_url:     `${origin}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:      `${origin}/billing?cancelled=true`,
      customer_id:     existingCompany?.stripe_customer_id ?? undefined,
    });

    return send(res, 200, { success: true, data: { url, session_id } });
  } catch (err) {
    return send(res, 502, { success: false, error: {
      code:    'STRIPE_ERROR',
      message: err.message,
    }});
  }
}

// POST /v1/billing/portal
async function handleCreatePortal(req, res, user) {
  if (!isStripeConfigured()) {
    return send(res, 503, { success: false, error: {
      code: 'STRIPE_NOT_CONFIGURED',
      message: 'Stripe is not configured on this server.',
    }});
  }

  const company_id = user?.company_id ?? user?.sub ?? null;
  if (!company_id) {
    return send(res, 400, { success: false, error: { code: 'NO_COMPANY', message: 'User has no company_id.' } });
  }

  const company = companyStore.get(company_id);
  if (!company?.stripe_customer_id) {
    return send(res, 404, { success: false, error: {
      code: 'NO_SUBSCRIPTION',
      message: 'No active subscription found. Please activate your plan first.',
    }});
  }

  const proto  = req.headers['x-forwarded-proto'] ?? 'http';
  const host   = req.headers['x-forwarded-host'] ?? req.headers['host'] ?? 'localhost:3003';
  const origin = `${proto}://${host}`;

  try {
    const { url } = await createBillingPortal({
      customer_id: company.stripe_customer_id,
      return_url:  `${origin}/billing`,
    });
    return send(res, 200, { success: true, data: { url } });
  } catch (err) {
    return send(res, 502, { success: false, error: {
      code:    'STRIPE_ERROR',
      message: err.message,
    }});
  }
}

// POST /v1/billing/webhook
// Stripe posts events here. We verify the signature, then update companyStore.
async function handleStripeWebhook(req, res) {
  // Read raw body WITHOUT parsing as JSON — signature verification requires raw bytes
  let rawBody;
  try { rawBody = await readBody(req, 1024 * 1024); }  // 1MB limit
  catch (err) { return send(res, 400, { error: 'Body read error' }); }

  const sigHeader = req.headers['stripe-signature'] ?? '';

  let event;
  try {
    event = constructWebhookEvent(rawBody, sigHeader);
  } catch (err) {
    console.warn('[STRIPE WEBHOOK] Signature verification failed:', err.message);
    return send(res, 400, { error: err.message });
  }

  try {
    await processStripeEvent(event);
  } catch (err) {
    // Log but return 200 — prevents Stripe from retrying for non-transient errors
    console.error('[STRIPE WEBHOOK] Event processing error:', err.message, event.type);
  }

  // Always return 200 to acknowledge receipt
  return send(res, 200, { received: true });
}

async function processStripeEvent(event) {
  const data = event.data?.object ?? {};

  switch (event.type) {
    // Checkout completed → subscription is now active
    case 'checkout.session.completed': {
      const company_id = data.metadata?.company_id;
      if (!company_id) break;

      const plan = data.metadata?.plan ?? 'starter';
      const now  = new Date().toISOString();
      const existing = companyStore.get(company_id) ?? {};

      companyStore.set(company_id, {
        ...existing,
        id:                    company_id,
        stripe_customer_id:    data.customer,
        stripe_subscription_id: data.subscription,
        subscription_status:   'active',
        plan,
        checkout_session_id:   data.id,
        updated_at:            now,
        created_at:            existing.created_at ?? now,
      });

      console.log(`[STRIPE] Subscription activated for company ${company_id} (plan: ${plan})`);
      break;
    }

    // Subscription updated (plan change, status change, etc.)
    case 'customer.subscription.updated': {
      const company_id = data.metadata?.company_id;
      if (!company_id) break;

      const priceId = data.items?.data?.[0]?.price?.id ?? '';
      const plan    = planFromPriceId(priceId) ?? 'starter';
      const existing = companyStore.get(company_id) ?? {};

      companyStore.set(company_id, {
        ...existing,
        id:                    company_id,
        stripe_customer_id:    data.customer,
        stripe_subscription_id: data.id,
        subscription_status:   data.status,
        plan,
        current_period_end:    data.current_period_end
          ? new Date(data.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end:  data.cancel_at_period_end ?? false,
        updated_at:            new Date().toISOString(),
      });

      console.log(`[STRIPE] Subscription updated for company ${company_id}: status=${data.status}, plan=${plan}`);
      break;
    }

    // Subscription deleted/cancelled
    case 'customer.subscription.deleted': {
      const company_id = data.metadata?.company_id;
      if (!company_id) break;

      const existing = companyStore.get(company_id) ?? {};
      companyStore.set(company_id, {
        ...existing,
        id:                    company_id,
        stripe_customer_id:    data.customer,
        stripe_subscription_id: data.id,
        subscription_status:   'cancelled',
        plan:                  existing.plan ?? null,
        updated_at:            new Date().toISOString(),
      });

      console.log(`[STRIPE] Subscription cancelled for company ${company_id}`);
      break;
    }

    // Payment succeeded — clear any overage lock (overages just paid), then
    // calculate overages for the period that just ended, lock if any exist,
    // and reset the counter for the new period.
    case 'invoice.payment_succeeded': {
      const customer_id = data.customer;
      // Only process subscription invoices (not one-time manual charges)
      if (data.billing_reason === 'manual') break;
      const company = companyStore.values().find(c => c.stripe_customer_id === customer_id);
      if (!company) break;

      const now     = new Date();
      const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      // ── Step 1: Clear any existing overage lock — this payment settled it ────
      // (The pending invoice item we created last period was included in this invoice)
      const wasLocked = company.overage_locked ?? false;

      const plan        = company.plan ?? 'starter';
      const planDetails = PLAN_DETAILS[plan] ?? PLAN_DETAILS.starter;
      const used        = company.invoices_this_period ?? 0;
      const included    = planDetails.invoices;
      const overageCount = Math.max(0, used - included);

      // ── Step 2: Charge overages for the period that just ended ────────────────
      let newLock = false;
      if (overageCount > 0) {
        const overageRate  = planDetails.overage;
        const overageTotal = overageCount * overageRate;
        const amountCents  = Math.round(overageTotal * 100);
        const description  = `Quote overage: ${overageCount} extra quote${overageCount !== 1 ? 's' : ''} × $${overageRate.toFixed(2)} (${planDetails.name} plan — ${included} included/mo)`;

        try {
          await createInvoiceItem({ customer_id, amount_cents: amountCents, description });
          newLock = true; // Lock until next invoice pays this item
          console.log(`[STRIPE] Overage invoice item created for company ${company.id}: ${overageCount} × $${overageRate} = $${overageTotal.toFixed(2)}`);
        } catch (err) {
          console.error(`[STRIPE] Failed to create overage invoice item for company ${company.id}:`, err.message);
        }
      }

      // ── Step 3: Reset counter, apply new lock state ───────────────────────────
      companyStore.set(company.id, {
        ...company,
        invoices_this_period: 0,
        usage_period:         periodKey,
        overage_locked:       newLock,
        overage_balance_cents: newLock ? Math.round(overageCount * planDetails.overage * 100) : 0,
        updated_at:           now.toISOString(),
      });

      console.log(`[STRIPE] Period reset for company ${company.id} — used ${used}/${included}, overage ${overageCount}, locked=${newLock}, prev lock cleared=${wasLocked}`);
      break;
    }

    // Payment failed — mark as past_due
    case 'invoice.payment_failed': {
      const customer_id = data.customer;
      // Find company by stripe_customer_id
      const company = companyStore.values().find(c => c.stripe_customer_id === customer_id);
      if (!company) break;

      companyStore.set(company.id, {
        ...company,
        subscription_status: 'past_due',
        updated_at:          new Date().toISOString(),
      });

      console.log(`[STRIPE] Payment failed for customer ${customer_id}`);
      break;
    }

    default:
      // Unhandled event types are fine — just ignore them
      break;
  }
}

// POST /v1/auth/signup  — public, no auth required
// Creates a new company admin account via the Supabase Admin API.
// In dev mode (no SUPABASE_URL / SUPABASE_SERVICE_KEY), simulates the signup
// and returns a dev-mode unsigned JWT so the UI can proceed.
async function handleSignup(req, res) {
  const body = await parseBody(req, res);
  if (body === null) return;

  const { email, password, company_name, plan } = body;

  // Validate
  if (!email || !password || !company_name) {
    return send(res, 400, { success: false, error: {
      code: 'MISSING_FIELDS', message: 'email, password, and company_name are required.' } });
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    return send(res, 400, { success: false, error: {
      code: 'INVALID_EMAIL', message: 'Please provide a valid email address.' } });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return send(res, 400, { success: false, error: {
      code: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters.' } });
  }

  const company_id   = randomUUID();
  const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY ?? '';
  const liveMode     = SUPABASE_URL && SERVICE_KEY &&
                       SERVICE_KEY !== 'your-service-role-key-here';

  if (liveMode) {
    // ── Real Supabase signup via Admin API ─────────────────────────────────────
    // Creates a pre-confirmed user so no email verification is needed.
    const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          role:         'admin',
          company_id,
          plan:         plan ?? 'starter',
          company_name: company_name.trim(),
        },
      }),
    });

    const adminData = await adminRes.json();
    if (!adminRes.ok) {
      const msg = adminData?.msg ?? adminData?.message ?? adminData?.error_description ?? 'Signup failed.';
      // Surface common errors with friendly messages
      if (adminRes.status === 422 && msg.toLowerCase().includes('already')) {
        return send(res, 409, { success: false, error: {
          code: 'EMAIL_TAKEN', message: 'An account with that email already exists. Try signing in instead.' } });
      }
      return send(res, adminRes.status, { success: false, error: { code: 'SIGNUP_FAILED', message: msg } });
    }

    return send(res, 201, { success: true, data: {
      email,
      company_id,
      plan:         plan ?? 'starter',
      company_name: company_name.trim(),
      user_id:      adminData.id,
    }});

  } else {
    // ── Dev mode — no Supabase configured ─────────────────────────────────────
    // Return a synthetic response so the frontend can proceed with a login call.
    // The login.js will hit the Supabase auth endpoint directly (and also fail
    // gracefully if the anon key is a placeholder), so this stays self-contained.
    console.log(`[SIGNUP DEV] Would create admin account for ${email} (company: ${company_name}, plan: ${plan ?? 'starter'})`);
    return send(res, 201, { success: true, data: {
      email,
      company_id,
      plan:         plan ?? 'starter',
      company_name: company_name.trim(),
      dev_mode:     true,
    }});
  }
}

// POST /v1/inspection
async function handleCreateInspection(req, res) {
  const body = await parseBody(req, res);
  if (body === null) return;

  const { company_id, technician_id, address, inspection_type, notes, metadata } = body;
  if (!company_id) return send(res, 400, { success: false, error: { code: 'INVALID_REQUEST', message: 'company_id required' } });

  const inspection = createInspection({ company_id, technician_id, address, inspection_type, notes });

  // FIX: merge metadata (checkpoints, deficiencies, location details) that the tech app sends
  // Previously this field was silently dropped, causing admin views to show no real data.
  let finalInspection = inspection;
  if (metadata && typeof metadata === 'object') {
    // BUG FIX: cap array sizes to prevent DoS via unbounded metadata payloads
    const cps  = Array.isArray(metadata.checkpoints)  ? metadata.checkpoints.slice(0, MAX_META_ARRAY)  : [];
    const defs = Array.isArray(metadata.deficiencies) ? metadata.deficiencies.slice(0, MAX_META_ARRAY) : [];
    finalInspection = {
      ...inspection,
      checkpoints:  cps,
      deficiencies: defs,
      city:         typeof metadata.city        === 'string' ? metadata.city.slice(0, 200)        : null,
      contact:      typeof metadata.contact     === 'string' ? metadata.contact.slice(0, 200)     : null,
      phone:        typeof metadata.phone       === 'string' ? metadata.phone.slice(0, 30)        : null,
      system_type:  typeof metadata.system_type === 'string' ? metadata.system_type.slice(0, 100) : null,
      num_floors:   typeof metadata.num_floors  === 'number' ? metadata.num_floors                : null,
      num_heads:    metadata.num_heads   ?? null,
      photo_count:  metadata.photo_count ?? 0,
    };
    inspectionStore.set(inspection.id, finalInspection);
  }

  bus.emit(EventTypes.INSPECTION_CREATED, { inspection_id: finalInspection.id, company_id },
    { correlation_id: finalInspection.id });
  return send(res, 201, { success: true, data: finalInspection });
}

// GET /v1/inspections  — admin list with optional ?status= filter
function handleListInspections(req, res, url) {
  const status  = url.searchParams.get('status');
  const exclude = url.searchParams.get('exclude'); // comma-separated states to exclude
  let list = inspectionStore.values();
  if (status)  list = list.filter(i => i.state === status);
  if (exclude) { const ex = new Set(exclude.split(',')); list = list.filter(i => !ex.has(i.state)); }
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return send(res, 200, { success: true, data: list, count: list.length });
}

// GET /v1/jobs  — list with optional ?status=, ?technician_id=, ?date= filters
function handleListJobs(req, res, url) {
  const status       = url.searchParams.get('status');
  const techId       = url.searchParams.get('technician_id');
  const dateFilter   = url.searchParams.get('date');       // YYYY-MM-DD
  let list = jobStore.values();
  if (status)     list = list.filter(j => j.state === status);
  if (techId)     list = list.filter(j => j.technician_id === techId);
  if (dateFilter) list = list.filter(j => j.scheduled_date === dateFilter);
  list.sort((a, b) => {
    // Sort by time_slot ascending when filtering for a tech's day
    if (techId && a.time_slot && b.time_slot) {
      return _parseTime(a.time_slot) - _parseTime(b.time_slot);
    }
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return send(res, 200, { success: true, data: list, count: list.length });
}

// Parse "8:00 AM" / "10:30 AM" / "1:00 PM" to minutes since midnight for sorting
function _parseTime(slot) {
  if (!slot) return 0;
  const m = slot.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return 0;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

// GET /v1/quotes  — admin list with optional ?status= filter
function handleListQuotes(req, res, url) {
  const status = url.searchParams.get('status');
  let list = quoteStore.values();
  if (status) list = list.filter(q => q.state === status);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return send(res, 200, { success: true, data: list, count: list.length });
}

// GET /v1/inspection/:id
function handleGetInspection(req, res, id) {
  const inspection = inspectionStore.get(id);
  if (!inspection) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Inspection ${id} not found` } });
  return send(res, 200, { success: true, data: inspection });
}

// BUG FIX: states that have real data ready for a report
const REPORTABLE_STATES = new Set(['submitted', 'processing', 'complete', 'failed']);

// GET /v1/inspection/:id/report — returns a self-contained HTML page for print-to-PDF
function handleGetInspectionReport(req, res, id) {
  const inspection = inspectionStore.get(id);
  if (!inspection) {
    // Return a tidy HTML 404 so the browser tab shows something useful
    const html = `<!DOCTYPE html><html><head><title>Not Found</title></head><body style="font-family:sans-serif;padding:40px"><h2>Inspection not found</h2><p>No inspection with ID <code>${id}</code> exists.</p></body></html>`;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    return res.end(html);
  }

  // BUG FIX: don't generate a report for draft/cancelled inspections — no useful data
  if (!REPORTABLE_STATES.has(inspection.state)) {
    const html = `<!DOCTYPE html><html><head><title>Report Not Available</title></head><body style="font-family:sans-serif;padding:40px"><h2>Report not available</h2><p>Inspection <code>${id}</code> is in state <strong>${inspection.state}</strong>. Reports are only available after the inspection has been submitted.</p></body></html>`;
    res.writeHead(422, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    return res.end(html);
  }

  const html = generateInspectionReport(inspection);
  res.writeHead(200, {
    'Content-Type':        'text/html; charset=utf-8',
    'Content-Length':      Buffer.byteLength(html),
    'Content-Disposition': `inline; filename="inspection-report-${id.slice(0,8)}.html"`,
    'Cache-Control':       'no-store',
  });
  return res.end(html);
}

// POST /v1/inspection/:id/recording
async function handleAddRecording(req, res, id) {
  const inspection = inspectionStore.get(id);
  if (!inspection) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Inspection ${id} not found` } });
  if (!InspectionMachine.canTransition(inspection.state, 'submit')) {
    return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: `Cannot add recording in state '${inspection.state}'` } });
  }

  const body = await parseBody(req, res);
  if (body === null) return;

  const { transcript, context } = body;
  if (!transcript || transcript.length < 10) {
    return send(res, 400, { success: false, error: { code: 'INVALID_REQUEST', message: 'transcript must be at least 10 characters' } });
  }

  const recId = randomUUID();
  const recordings = [...(inspection.voice_recordings ?? []), {
    id: recId, transcript, context: context ?? {}, processed: false, created_at: new Date().toISOString(),
  }];

  inspectionStore.set(id, { ...inspection, voice_recordings: recordings, updated_at: new Date().toISOString() });
  bus.emit(EventTypes.INSPECTION_VOICE_ADDED, { inspection_id: id, recording_id: recId },
    { correlation_id: id });

  return send(res, 201, { success: true, data: { recording_id: recId } });
}

// POST /v1/inspection/:id/image
async function handleAddImage(req, res, id) {
  const inspection = inspectionStore.get(id);
  if (!inspection) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Inspection ${id} not found` } });
  if (!InspectionMachine.canTransition(inspection.state, 'submit')) {
    return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: `Cannot add image in state '${inspection.state}'` } });
  }

  const body = await parseBody(req, res);
  if (body === null) return;

  const { image, context } = body;
  if (!image || !image.type) {
    return send(res, 400, { success: false, error: { code: 'INVALID_REQUEST', message: 'image.type required (base64 or url)' } });
  }

  const imgId = randomUUID();
  const images = [...(inspection.images ?? []), {
    id: imgId, image, context: context ?? {}, processed: false, created_at: new Date().toISOString(),
  }];

  inspectionStore.set(id, { ...inspection, images, updated_at: new Date().toISOString() });
  bus.emit(EventTypes.INSPECTION_IMAGE_ADDED, { inspection_id: id, image_id: imgId },
    { correlation_id: id });

  return send(res, 201, { success: true, data: { image_id: imgId } });
}

// POST /v1/inspection/:id/submit
async function handleSubmitInspection(req, res, id) {
  let inspection;
  try {
    inspection = submitInspection(id);
  } catch (err) {
    if (err.code === 'NOT_FOUND' || err.message.includes('not found')) {
      return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: err.message } });
    }
    if (err.code === 'INVALID_TRANSITION' || err.code === 'TERMINAL_STATE') {
      return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: err.message } });
    }
    throw err;
  }
  return send(res, 200, { success: true, data: inspection });
}

// POST /v1/quote  — admin creates a quote manually (bypasses AI pipeline)
async function handleCreateQuote(req, res) {
  const body = await parseBody(req, res);
  if (body === null) return;

  const { company_id, inspection_id, customer_email, address, contact, line_items, notes, valid_until } = body;
  if (!company_id) return send(res, 400, { success: false, error: { code: 'INVALID_REQUEST', message: 'company_id required' } });

  // Create base entity then promote directly to review (skip AI pipeline)
  const base = createQuote({ company_id, inspection_id: inspection_id ?? null });
  const now  = new Date().toISOString();
  const quote = {
    ...base,
    customer_email: customer_email ?? null,
    address:        address        ?? null,
    contact:        contact        ?? null,
    line_items:     Array.isArray(line_items) ? line_items : [],
    notes:          notes          ?? null,
    valid_until:    valid_until    ?? null,
    state:          'review',
    state_history:  [{ from: 'draft', to: 'review', event: 'manual_create', at: now }],
    updated_at:     now,
  };
  // ── Block creation if account is locked for unpaid overages ─────────────────
  if (company_id) {
    const co = companyStore.get(company_id);
    if (co?.overage_locked) {
      return send(res, 402, { success: false, error: {
        code:    'OVERAGE_UNPAID',
        message: 'Your account has an outstanding overage balance from last billing period. New quotes are paused until your next invoice is processed by Stripe (usually within minutes of your renewal date).',
      }});
    }
  }

  quoteStore.set(base.id, quote);

  // ── Track monthly usage for quota / overage billing ──────────────────────────
  if (company_id) {
    const company = companyStore.get(company_id) ?? { id: company_id };
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const prevPeriod = company.usage_period ?? '';
    const count = prevPeriod === periodKey ? (company.invoices_this_period ?? 0) + 1 : 1;
    companyStore.set(company_id, {
      ...company,
      invoices_this_period: count,
      usage_period:         periodKey,
      updated_at:           now.toISOString(),
    });
  }

  return send(res, 201, { success: true, data: quote });
}

// POST /v1/quote/:id/send  — transitions review→sent, returns signed customer link
async function handleSendQuote(req, res, id) {
  const quote = quoteStore.get(id);
  if (!quote) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Quote ${id} not found` } });

  const body = await parseBody(req, res);
  if (body === null) return;

  // Optionally update customer email before sending
  const { customer_email } = body;
  if (customer_email) {
    quoteStore.set(id, { ...quoteStore.get(id), customer_email, updated_at: new Date().toISOString() });
  }

  // Transition review → sent
  try {
    quoteStore.applyTransition(id, QuoteMachine, 'approve');
  } catch (err) {
    if (err.code === 'INVALID_TRANSITION' || err.code === 'TERMINAL_STATE') {
      return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: err.message } });
    }
    throw err;
  }

  // Generate signed customer token (falls back to unsigned JWT in dev mode)
  let customerToken;
  const updatedQuote = quoteStore.get(id);
  try {
    customerToken = generateCustomerToken(id, updatedQuote.company_id);
  } catch (_) {
    // Dev mode — no SUPABASE_JWT_SECRET configured; issue an unsigned JWT
    // The server (DISABLE_AUTH=true) will skip verification on inbound requests.
    const hdr = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const bdy = Buffer.from(JSON.stringify({
      sub:        id,
      quote_id:   id,
      company_id: updatedQuote.company_id ?? '',
      type:       'customer_quote',
      iat:        Math.floor(Date.now() / 1000),
      exp:        Math.floor(Date.now() / 1000) + 30 * 86_400,
    })).toString('base64url');
    customerToken = `${hdr}.${bdy}.`;
  }

  const proto       = req.headers['x-forwarded-proto'] ?? 'http';
  const host        = req.headers.host ?? 'localhost:3003';
  const customerUrl = `${proto}://${host}/customer-quote?token=${customerToken}`;

  // Persist token + URL on the quote
  quoteStore.set(id, { ...quoteStore.get(id), customer_token: customerToken, customer_url: customerUrl, updated_at: new Date().toISOString() });

  return send(res, 200, {
    success: true,
    data: {
      quote:          quoteStore.get(id),
      customer_url:   customerUrl,
      customer_token: customerToken,
    },
  });
}

// GET /v1/quote/:id
function handleGetQuote(req, res, id) {
  const quote = quoteStore.get(id);
  if (!quote) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Quote ${id} not found` } });
  return send(res, 200, { success: true, data: quote });
}

// POST /v1/quote/:id/approve
async function handleApproveQuote(req, res, id) {
  try {
    const quote = approveQuote(id);
    await bus.drain();
    return send(res, 200, { success: true, data: quoteStore.get(id) ?? quote });
  } catch (err) {
    if (err.message.includes('not found')) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: err.message } });
    if (err.code === 'INVALID_TRANSITION') return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: err.message } });
    throw err;
  }
}

// POST /v1/quote/:id/reject  (admin rejects a quote in review state)
async function handleAdminRejectQuote(req, res, id) {
  const quote = quoteStore.get(id);
  if (!quote) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Quote ${id} not found` } });
  try {
    const body = await parseBody(req, res);
    if (body === null) return;
    quoteStore.applyTransition(id, QuoteMachine, 'reject', { rejection_reason: body.reason ?? '' });
    return send(res, 200, { success: true, data: quoteStore.get(id) });
  } catch (err) {
    if (err.code === 'INVALID_TRANSITION') return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: err.message } });
    throw err;
  }
}

// POST /v1/quote/:id/accept  (customer)
async function handleAcceptQuote(req, res, id) {
  try {
    acceptQuote(id);
    await bus.drain();
    return send(res, 200, { success: true, data: quoteStore.get(id) });
  } catch (err) {
    if (err.message.includes('not found')) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: err.message } });
    // BUG FIX: idempotency — if already accepted, return 409 instead of 500
    if (err.code === 'INVALID_TRANSITION' || err.code === 'TERMINAL_STATE') {
      return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: err.message } });
    }
    throw err;
  }
}

// POST /v1/quote/:id/customer-reject
async function handleRejectQuote(req, res, id) {
  const body = await parseBody(req, res);
  if (body === null) return;
  try {
    rejectQuote(id, body.reason ?? '');
    return send(res, 200, { success: true, data: quoteStore.get(id) });
  } catch (err) {
    if (err.message.includes('not found')) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: err.message } });
    // BUG FIX: idempotency — double-reject returns 409 instead of 500
    if (err.code === 'INVALID_TRANSITION' || err.code === 'TERMINAL_STATE') {
      return send(res, 409, { success: false, error: { code: 'INVALID_STATE', message: err.message } });
    }
    throw err;
  }
}

// GET /v1/job/:id
function handleGetJob(req, res, id) {
  const job = jobStore.get(id);
  if (!job) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Job ${id} not found` } });
  return send(res, 200, { success: true, data: job });
}

// POST /v1/job/:id/assign  — assign a technician + time slot; persists the schedule.
// Transitions pending → scheduled on first call.  On a reschedule the slot + tech
// are updated in-place without a state change (idempotent).
async function handleAssignJob(req, res, id) {
  const job = jobStore.get(id);
  if (!job) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Job ${id} not found` } });

  const body = await parseBody(req, res);
  if (body === null) return;

  const { technician_id, time_slot, scheduled_date } = body;
  if (!technician_id || !time_slot) {
    return send(res, 400, { success: false, error: {
      code:    'MISSING_FIELDS',
      message: 'technician_id and time_slot are required.',
    }});
  }

  // First assignment → transition pending → scheduled
  if (job.state === 'pending') {
    try {
      jobStore.applyTransition(id, JobMachine, 'schedule');
    } catch (err) {
      if (err.code !== 'INVALID_TRANSITION' && err.code !== 'TERMINAL_STATE') throw err;
    }
  } else if (job.state === 'scheduled') {
    // Reschedule — keep the state, just update the slot metadata below
    try { jobStore.applyTransition(id, JobMachine, 'reschedule'); } catch (_) { /* ok */ }
  } else if (job.state !== 'in_progress') {
    // Can't reschedule a completed/cancelled job
    return send(res, 409, { success: false, error: {
      code:    'INVALID_STATE',
      message: `Cannot assign a job in state '${job.state}'.`,
    }});
  }

  // Persist scheduling metadata
  const now = new Date().toISOString();
  jobStore.set(id, {
    ...jobStore.get(id),
    technician_id,
    time_slot,
    scheduled_date: scheduled_date ?? now.split('T')[0],
    updated_at:     now,
  });

  bus.emit('JOB_ASSIGNED', { job_id: id, technician_id, time_slot }, { correlation_id: id });
  return send(res, 200, { success: true, data: jobStore.get(id) });
}

// POST /v1/job/:id/start  — technician dispatches: scheduled → in_progress
function handleStartJob(req, res, id) {
  const job = jobStore.get(id);
  if (!job) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Job ${id} not found` } });
  try {
    jobStore.applyTransition(id, JobMachine, 'dispatch');
  } catch (err) {
    return send(res, 409, { success: false, error: { code: err.code ?? 'INVALID_TRANSITION', message: err.message } });
  }
  const now = new Date().toISOString();
  jobStore.set(id, { ...jobStore.get(id), started_at: now, updated_at: now });
  bus.emit('JOB_STARTED', { job_id: id }, { correlation_id: id });
  return send(res, 200, { success: true, data: jobStore.get(id) });
}

// POST /v1/job/:id/complete  — technician completes: in_progress → completed
function handleCompleteJob(req, res, id) {
  const job = jobStore.get(id);
  if (!job) return send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `Job ${id} not found` } });
  try {
    jobStore.applyTransition(id, JobMachine, 'complete');
  } catch (err) {
    return send(res, 409, { success: false, error: { code: err.code ?? 'INVALID_TRANSITION', message: err.message } });
  }
  const now = new Date().toISOString();
  jobStore.set(id, { ...jobStore.get(id), completed_at: now, updated_at: now });
  bus.emit('JOB_COMPLETED', { job_id: id }, { correlation_id: id });
  return send(res, 200, { success: true, data: jobStore.get(id) });
}

// GET /v1/queue/stats
function handleQueueStats(req, res) {
  const stats = {};
  for (const [name, q] of Object.entries(queues)) {
    stats[name] = q.stats();
  }
  return send(res, 200, { success: true, data: stats });
}

// GET /v1/queue/dlq
function handleQueueDlq(req, res) {
  const dlq = {};
  for (const [name, q] of Object.entries(queues)) {
    dlq[name] = q.listDlq();
  }
  return send(res, 200, { success: true, data: dlq });
}

// GET /v1/stream  — SSE
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send a comment heartbeat every 15s to keep proxies alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { /* client gone */ }
  }, 15_000);
  heartbeat.unref?.();

  sseClients.add(res);

  // Replay recent event log so the client gets current state
  const recent = bus.eventLog(e => Date.now() - e.emitted_at < 60_000);
  for (const event of recent) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
  });
}

// ─── Main server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  const ip        = getIp(req);
  const method    = req.method ?? 'GET';
  const url       = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path      = url.pathname;

  // BUG FIX: restrict CORS to a configured origin instead of wildcard '*'.
  // In dev mode (ALLOWED_ORIGIN not set) allow the request's own origin so
  // the browser SPA works without configuration.  In production set ALLOWED_ORIGIN.
  const requestOrigin = req.headers['origin'] ?? '';
  const corsOrigin = ALLOWED_ORIGIN ?? requestOrigin ?? '*';
  res.setHeader('Access-Control-Allow-Origin',  corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Request-Id', requestId);

  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ── Static file serving (anything not starting with /v1 or /health) ─────────
  if (method === 'GET' && !path.startsWith('/v1') && path !== '/health' && path !== '/ready') {
    return serveStatic(req, res, path);
  }

  if (isRateLimited(ip) && method !== 'GET') {
    return send(res, 429, { success: false, error: { code: 'RATE_LIMITED', message: `Max ${RATE_MAX} requests per ${RATE_WIN_MS / 1000}s.` } });
  }

  try {
    // ── Public routes (no auth required) ──────────────────────────────────────

    // Signup — always public (creates company + admin account)
    if (path === '/v1/auth/signup' && method === 'POST') {
      return await handleSignup(req, res);
    }

    // Stripe webhook — public, but Stripe-signature verified internally
    if (path === '/v1/billing/webhook' && method === 'POST') {
      return await handleStripeWebhook(req, res);
    }

    // Health — always public
    if ((path === '/health' || path === '/ready') && method === 'GET') {
      const qStats = {};
      for (const [n, q] of Object.entries(queues)) qStats[n] = q.stats();
      const dbHealth = await ping();
      return send(res, 200, {
        status:      'ok',
        timestamp:   new Date().toISOString(),
        auth:        { enabled: authEnabled() },
        db:          { configured: isConfigured(), ...dbHealth },
        queues:      qStats,
        sse_clients: sseClients.size,
      });
    }

    // ── Auth-gated routes ─────────────────────────────────────────────────────
    // When SUPABASE_JWT_SECRET is set, every route below requires a valid token.
    // Set DISABLE_AUTH=true in .env during local development to skip checks.

    // SSE stream — admin only in production
    if (path === '/v1/stream' && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return handleSSE(req, res);
    }

    // Inspection routes — technician or admin
    if (path === '/v1/inspection' && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['technician', 'admin'])) return;
      return await handleCreateInspection(req, res);
    }

    const inspMatch = path.match(/^\/v1\/inspection\/([^/]+)$/);
    if (inspMatch && method === 'GET') {
      if (authEnabled()) {
        const user = requireAuth(req, res, ['technician', 'admin']);
        if (!user) return;
        const insp = inspectionStore.get(inspMatch[1]);
        if (insp && user.role !== 'admin' && insp.company_id !== user.company_id) {
          return send(res, 403, { success: false, error: { code: 'FORBIDDEN', message: 'Access denied.' } });
        }
      }
      return handleGetInspection(req, res, inspMatch[1]);
    }

    const reportMatch = path.match(/^\/v1\/inspection\/([^/]+)\/report$/);
    if (reportMatch && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin', 'technician'])) return;
      return handleGetInspectionReport(req, res, reportMatch[1]);
    }

    const recMatch = path.match(/^\/v1\/inspection\/([^/]+)\/recording$/);
    if (recMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['technician', 'admin'])) return;
      return await handleAddRecording(req, res, recMatch[1]);
    }

    const imgMatch = path.match(/^\/v1\/inspection\/([^/]+)\/image$/);
    if (imgMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['technician', 'admin'])) return;
      return await handleAddImage(req, res, imgMatch[1]);
    }

    const submitMatch = path.match(/^\/v1\/inspection\/([^/]+)\/submit$/);
    if (submitMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['technician', 'admin'])) return;
      return await handleSubmitInspection(req, res, submitMatch[1]);
    }

    // List endpoints — admin only
    if (path === '/v1/inspections' && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return handleListInspections(req, res, url);
    }

    if (path === '/v1/jobs' && method === 'GET') {
      // Technicians can query their own jobs; admins can query all
      if (authEnabled() && !requireAuth(req, res, ['admin', 'technician'])) return;
      return handleListJobs(req, res, url);
    }

    if (path === '/v1/quotes' && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return handleListQuotes(req, res, url);
    }

    // Quote routes — admin creates/approves/rejects, customer accepts/rejects
    if (path === '/v1/quote' && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return await handleCreateQuote(req, res);
    }

    const quoteMatch = path.match(/^\/v1\/quote\/([^/]+)$/);
    if (quoteMatch && method === 'GET') {
      if (authEnabled()) {
        const user = requireAuth(req, res, ['admin', 'customer']);
        if (!user) return;
        // Customer tokens are scoped to a single quote
        if (user.role === 'customer' && user.quote_id !== quoteMatch[1]) {
          return send(res, 403, { success: false, error: { code: 'FORBIDDEN', message: 'Token is not valid for this quote.' } });
        }
      }
      return handleGetQuote(req, res, quoteMatch[1]);
    }

    const sendMatch = path.match(/^\/v1\/quote\/([^/]+)\/send$/);
    if (sendMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return await handleSendQuote(req, res, sendMatch[1]);
    }

    const approveMatch = path.match(/^\/v1\/quote\/([^/]+)\/approve$/);
    if (approveMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return await handleApproveQuote(req, res, approveMatch[1]);
    }

    const adminRejectMatch = path.match(/^\/v1\/quote\/([^/]+)\/reject$/);
    if (adminRejectMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return await handleAdminRejectQuote(req, res, adminRejectMatch[1]);
    }

    // Customer routes — verified by customer quote token
    const acceptMatch = path.match(/^\/v1\/quote\/([^/]+)\/accept$/);
    if (acceptMatch && method === 'POST') {
      if (authEnabled()) {
        const user = requireAuth(req, res, ['customer', 'admin']);
        if (!user) return;
        // Customer tokens are locked to a specific quote
        if (user.role === 'customer' && user.quote_id !== acceptMatch[1]) {
          return send(res, 403, { success: false, error: { code: 'FORBIDDEN', message: 'Token is not valid for this quote.' } });
        }
      }
      return await handleAcceptQuote(req, res, acceptMatch[1]);
    }

    const custRejectMatch = path.match(/^\/v1\/quote\/([^/]+)\/customer-reject$/);
    if (custRejectMatch && method === 'POST') {
      if (authEnabled()) {
        const user = requireAuth(req, res, ['customer', 'admin']);
        if (!user) return;
        if (user.role === 'customer' && user.quote_id !== custRejectMatch[1]) {
          return send(res, 403, { success: false, error: { code: 'FORBIDDEN', message: 'Token is not valid for this quote.' } });
        }
      }
      return await handleRejectQuote(req, res, custRejectMatch[1]);
    }

    // Job routes — admin only
    const jobMatch = path.match(/^\/v1\/job\/([^/]+)$/);
    if (jobMatch && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return handleGetJob(req, res, jobMatch[1]);
    }

    const assignMatch = path.match(/^\/v1\/job\/([^/]+)\/assign$/);
    if (assignMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return await handleAssignJob(req, res, assignMatch[1]);
    }

    const startMatch = path.match(/^\/v1\/job\/([^/]+)\/start$/);
    if (startMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin', 'technician'])) return;
      return handleStartJob(req, res, startMatch[1]);
    }

    const completeMatch = path.match(/^\/v1\/job\/([^/]+)\/complete$/);
    if (completeMatch && method === 'POST') {
      if (authEnabled() && !requireAuth(req, res, ['admin', 'technician'])) return;
      return handleCompleteJob(req, res, completeMatch[1]);
    }

    // Queue management — admin only
    if (path === '/v1/queue/stats' && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return handleQueueStats(req, res);
    }
    if (path === '/v1/queue/dlq' && method === 'GET') {
      if (authEnabled() && !requireAuth(req, res, ['admin'])) return;
      return handleQueueDlq(req, res);
    }

    // Billing routes — admin only
    // Company branding — admin only
    if (path === '/v1/company/branding' && method === 'GET') {
      const user = authEnabled() ? requireAuth(req, res, ['admin']) : { company_id: null, sub: null };
      if (authEnabled() && !user) return;
      const company_id = user?.company_id ?? user?.sub ?? 'default';
      const company = companyStore.get(company_id) ?? {};
      return send(res, 200, { success: true, data: company.branding ?? {} });
    }

    if (path === '/v1/company/branding' && method === 'POST') {
      const user = authEnabled() ? requireAuth(req, res, ['admin']) : { company_id: null, sub: null };
      if (authEnabled() && !user) return;
      const company_id = user?.company_id ?? user?.sub ?? 'default';
      let brandRaw;
      try { brandRaw = await readBody(req, 5 * 1024 * 1024); } // 5MB for logo
      catch (err) { return send(res, 413, { success: false, error: { code: 'TOO_LARGE', message: 'Logo must be under 5 MB.' } }); }
      let body;
      try { body = JSON.parse(brandRaw || '{}'); }
      catch (_) { return send(res, 400, { success: false, error: { code: 'INVALID_JSON', message: 'Invalid JSON.' } }); }
      const existing = companyStore.get(company_id) ?? { id: company_id };
      const allowed = ['companyName','logoDataUrl','primaryColor','contactPhone','contactEmail','contactWebsite','footerText','address'];
      const branding = {};
      for (const key of allowed) {
        if (key in body) branding[key] = body[key];
      }
      companyStore.set(company_id, { ...existing, branding: { ...(existing.branding ?? {}), ...branding }, updated_at: new Date().toISOString() });
      return send(res, 200, { success: true, data: companyStore.get(company_id).branding });
    }

    if (path === '/v1/billing/usage' && method === 'GET') {
      const user = authEnabled() ? requireAuth(req, res, ['admin']) : { company_id: 'dev', sub: 'dev', email: null };
      if (authEnabled() && !user) return;
      const company_id = user?.company_id ?? user?.sub ?? null;
      const company    = company_id ? (companyStore.get(company_id) ?? {}) : {};
      const plan       = company.plan ?? 'starter';
      const planDetails = PLAN_DETAILS[plan] ?? PLAN_DETAILS.starter;
      const used       = company.invoices_this_period ?? 0;
      const included   = planDetails.invoices;
      const overage    = Math.max(0, used - included);
      return send(res, 200, { success: true, data: {
        plan,
        used,
        included,
        overage,
        overage_rate:          planDetails.overage,
        overage_balance_cents: company.overage_balance_cents ?? 0,
        overage_locked:        company.overage_locked ?? false,
        usage_period:          company.usage_period ?? null,
      }});
    }

    if (path === '/v1/billing/subscription' && method === 'GET') {
      const user = authEnabled() ? requireAuth(req, res, ['admin']) : { company_id: 'dev', sub: 'dev', email: null };
      if (authEnabled() && !user) return;
      return handleGetSubscription(req, res, user);
    }
    if (path === '/v1/billing/checkout' && method === 'POST') {
      const user = authEnabled() ? requireAuth(req, res, ['admin']) : { company_id: 'dev', sub: 'dev', email: null };
      if (authEnabled() && !user) return;
      return await handleCreateCheckout(req, res, user);
    }
    if (path === '/v1/billing/portal' && method === 'POST') {
      const user = authEnabled() ? requireAuth(req, res, ['admin']) : { company_id: 'dev', sub: 'dev', email: null };
      if (authEnabled() && !user) return;
      return await handleCreatePortal(req, res, user);
    }

    send(res, 404, { success: false, error: { code: 'NOT_FOUND', message: `${method} ${path} not found.` } });

  } catch (err) {
    console.error(`[${requestId}] Unhandled:`, err);
    send(res, 500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected error.' } });
  }
});

// ─── Bootstrap: load persisted state from DB before accepting traffic ─────────

async function bootstrap() {
  if (!isConfigured()) {
    console.warn('[DB] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — running with in-memory storage only');
    return;
  }

  console.log('[DB] Connecting to Supabase…');
  const health = await ping();
  if (!health.ok) {
    console.error(`[DB] Cannot reach Supabase (${health.error ?? health.status}) — starting without DB bootstrap`);
    return;
  }
  console.log(`[DB] Connected (${health.latencyMs}ms). Loading state…`);

  await Promise.all([
    inspectionStore.loadFromDb(),
    quoteStore.loadFromDb(),
    jobStore.loadFromDb(),
    companyStore.loadFromDb(),
  ]);

  console.log('[DB] Bootstrap complete.');
}

server.listen(PORT, HOST, async () => {
  console.log(`Fire Flow Workflow Engine listening on ${HOST}:${PORT}`);
  await bootstrap();
});
server.on('error', err => { console.error('Server error:', err); process.exit(1); });

function shutdown(sig) {
  console.log(`\n${sig} — closing…`);
  server.close(() => { process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

export { server };
