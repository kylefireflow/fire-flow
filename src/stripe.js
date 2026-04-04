/**
 * stripe.js — Stripe API client (zero npm dependencies)
 *
 * All HTTP calls use Node's native fetch with application/x-www-form-urlencoded
 * bodies, matching Stripe's API format exactly.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY         sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET     whsec_...  (from Stripe Dashboard → Webhooks)
 *   STRIPE_STARTER_PRICE_ID   price_... for the $200/month Small Team plan
 *   STRIPE_COMPANY_PRICE_ID   price_... for the $550/month Full Plan
 *
 * Optional:
 *   STRIPE_TRIAL_DAYS         (default: 0 — no trial)
 *
 * ─── Supported operations ─────────────────────────────────────────────────────
 *   createCheckoutSession    Hosted Checkout for a new subscription
 *   createBillingPortal      Customer Portal for managing existing subscription
 *   constructWebhookEvent    Verify + parse a Stripe webhook POST body
 *   getSubscription          Fetch a subscription object from Stripe
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY     = process.env.STRIPE_SECRET_KEY         ?? '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET      ?? '';
const STRIPE_API_BASE       = 'https://api.stripe.com/v1';

// Price IDs come from the Stripe Dashboard → Products
const PRICE_IDS = {
  starter: process.env.STRIPE_STARTER_PRICE_ID ?? '',
  growth:  process.env.STRIPE_GROWTH_PRICE_ID  ?? '',
  pro:     process.env.STRIPE_PRO_PRICE_ID     ?? '',
};

export function isStripeConfigured() {
  return !!(
    STRIPE_SECRET_KEY &&
    STRIPE_SECRET_KEY.startsWith('sk_') &&
    PRICE_IDS.starter
  );
}

export function getPlanPriceId(plan) {
  return PRICE_IDS[plan] ?? PRICE_IDS.starter;
}

// ─── Form encoding ────────────────────────────────────────────────────────────
// Stripe requires application/x-www-form-urlencoded with nested objects using
// bracket notation: metadata[company_id]=abc, line_items[0][price]=price_xxx

function formEncode(data, prefix = '') {
  const parts = [];
  for (const [key, val] of Object.entries(data)) {
    if (val === null || val === undefined) continue;
    const fullKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          parts.push(formEncode(item, `${fullKey}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${fullKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof val === 'object') {
      parts.push(formEncode(val, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(val))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

// ─── HTTP client ──────────────────────────────────────────────────────────────

async function stripeRequest(method, path, params = {}) {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');

  const url  = `${STRIPE_API_BASE}${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',  // pin API version
    },
  };

  if (method === 'GET') {
    const qs = formEncode(params);
    if (qs) opts.url = `${url}?${qs}`;
  } else {
    opts.body = formEncode(params);
  }

  const res  = await fetch(method === 'GET' && formEncode(params) ? `${url}?${formEncode(params)}` : url, opts);
  const data = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message ?? `Stripe error ${res.status}`;
    const err = new Error(msg);
    err.stripe_code = data?.error?.code ?? null;
    err.stripe_type = data?.error?.type ?? null;
    err.status      = res.status;
    throw err;
  }

  return data;
}

// ─── Checkout Session ─────────────────────────────────────────────────────────

/**
 * Create a hosted Checkout Session for a new subscription.
 *
 * @param {object} opts
 * @param {string} opts.company_id       Your internal company UUID
 * @param {string} opts.company_name     Display name
 * @param {string} opts.customer_email   Pre-fills the Stripe Checkout form
 * @param {string} opts.plan             'starter' | 'company'
 * @param {string} opts.success_url      Where Stripe redirects after payment
 * @param {string} opts.cancel_url       Where Stripe redirects if user cancels
 * @param {string} [opts.customer_id]    Existing Stripe customer ID (optional)
 * @returns {Promise<{ url: string, session_id: string }>}
 */
export async function createCheckoutSession({
  company_id, company_name, customer_email, plan,
  success_url, cancel_url, customer_id,
}) {
  const priceId = getPlanPriceId(plan);
  if (!priceId) throw new Error(`No Stripe price ID configured for plan: ${plan}`);

  const params = {
    mode:                'subscription',
    success_url,
    cancel_url,
    'line_items[0][price]':    priceId,
    'line_items[0][quantity]': 1,
    'subscription_data[metadata][company_id]':   company_id,
    'subscription_data[metadata][plan]':         plan,
    'metadata[company_id]':   company_id,
    'metadata[plan]':         plan,
    'metadata[company_name]': company_name ?? '',
  };

  // Attach to existing customer or pre-fill email
  if (customer_id) {
    params.customer = customer_id;
  } else if (customer_email) {
    params.customer_email = customer_email;
  }

  // Allow address collection for billing address on receipt
  params.billing_address_collection = 'auto';

  const session = await stripeRequest('POST', '/checkout/sessions', params);
  return { url: session.url, session_id: session.id };
}

// ─── Customer Portal ──────────────────────────────────────────────────────────

/**
 * Create a Stripe Customer Portal session.
 * The portal lets customers update their payment method, view invoices,
 * upgrade/downgrade plans, and cancel.
 *
 * @param {object} opts
 * @param {string} opts.customer_id   Stripe customer ID (cus_xxx)
 * @param {string} opts.return_url    Where to redirect when done in portal
 * @returns {Promise<{ url: string }>}
 */
export async function createBillingPortal({ customer_id, return_url }) {
  if (!customer_id) throw new Error('customer_id is required for billing portal');

  const session = await stripeRequest('POST', '/billing_portal/sessions', {
    customer:   customer_id,
    return_url,
  });
  return { url: session.url };
}

// ─── Webhook verification ─────────────────────────────────────────────────────

/**
 * Verify a Stripe webhook signature and return the parsed event.
 * Stripe signs events using HMAC-SHA256 with a timestamp to prevent replay attacks.
 *
 * @param {string|Buffer} rawBody     The raw request body (must NOT be parsed yet)
 * @param {string}        sigHeader   The Stripe-Signature header value
 * @returns {object}                  Parsed Stripe event
 * @throws {Error}                    If signature is invalid or expired
 */
export function constructWebhookEvent(rawBody, sigHeader) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }

  // Parse: Stripe-Signature: t=1614556800,v1=abc123,v0=...
  const pairs = Object.fromEntries(
    sigHeader.split(',').map(part => {
      const eq = part.indexOf('=');
      return [part.slice(0, eq), part.slice(eq + 1)];
    })
  );

  const timestamp = parseInt(pairs.t ?? '0', 10);
  const signature = pairs.v1 ?? '';

  // Reject events older than 5 minutes (replay attack protection)
  const MAX_AGE_SECONDS = 300;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_AGE_SECONDS) {
    throw new Error(`Webhook timestamp too old (${now - timestamp}s). Possible replay attack.`);
  }

  // Compute expected HMAC
  const body    = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signed  = `${timestamp}.${body}`;
  const expected = createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(signed, 'utf8')
    .digest('hex');

  // Constant-time compare to prevent timing attacks
  const expectedBuf = Buffer.from(expected, 'hex');
  const sigBuf      = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
    throw new Error('Webhook signature verification failed');
  }

  return JSON.parse(body);
}

// ─── Fetch existing subscription ──────────────────────────────────────────────

/**
 * Retrieve a subscription from Stripe.
 * @param {string} subscriptionId   sub_xxx
 */
export async function getSubscription(subscriptionId) {
  return stripeRequest('GET', `/subscriptions/${subscriptionId}`, {
    'expand[0]': 'latest_invoice',
  });
}

// ─── Plan helpers ─────────────────────────────────────────────────────────────

export const PLAN_DETAILS = {
  starter: { name: 'Starter', price: '$149', priceNum: 149, invoices: 50,  overage: 2.00 },
  growth:  { name: 'Growth',  price: '$249', priceNum: 249, invoices: 120, overage: 1.50 },
  pro:     { name: 'Pro',     price: '$399', priceNum: 399, invoices: 300, overage: 1.00 },
};

/**
 * Create a one-time invoice item attached to a Stripe customer.
 * It will be picked up automatically on their next invoice.
 *
 * @param {object} opts
 * @param {string} opts.customer_id   Stripe customer ID (cus_xxx)
 * @param {number} opts.amount_cents  Amount in cents (e.g. 400 = $4.00)
 * @param {string} opts.description   Line item description
 * @param {string} [opts.currency]    Defaults to 'usd'
 */
export async function createInvoiceItem({ customer_id, amount_cents, description, currency = 'usd' }) {
  return stripeRequest('POST', '/invoiceitems', {
    customer:    customer_id,
    amount:      amount_cents,
    currency,
    description,
  });
}

export function planFromPriceId(priceId) {
  if (priceId === PRICE_IDS.pro)      return 'pro';
  if (priceId === PRICE_IDS.growth)   return 'growth';
  if (priceId === PRICE_IDS.starter)  return 'starter';
  return 'starter';
}
