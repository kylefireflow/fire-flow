/**
 * quote.worker.js — Calls the quote-engine service to generate a quote
 *
 * Job payload:
 *   {
 *     inspection_id: string
 *     quote_id:      string     — workflow quote entity ID
 *     company_id:    string
 *     customer_id:   string
 *     deficiencies:  Array      — from inspection.deficiencies
 *     options:       object     — { include_tax, force_ai_for_all, notes }
 *   }
 *
 * On success:  emits QUOTE_GENERATED, stores engine result on quote entity
 * On failure:  nack → retry, or DLQ → emits QUOTE_FAILED
 */

import { queues }            from '../queue.js';
import { bus, EventTypes }   from '../events.js';
import { quoteStore }        from '../state.js';

const QUOTE_SERVICE_URL = process.env.QUOTE_SERVICE_URL ?? 'http://localhost:3002';
// MOCK_WORKERS checked at runtime via process.env

let _running  = false;
let _interval = null;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? '500', 10);

// ─── Mock response ────────────────────────────────────────────────────────────

function mockQuoteResult(payload) {
  const { deficiencies = [], company_id, customer_id } = payload;
  const lineItems = deficiencies.map((def, i) => ({
    deficiency_id:    def.id,
    description:      `Repair: ${def.type}`,
    part_sku:         '',
    part_description: 'Parts TBD',
    quantity:         def.quantity ?? 1,
    unit_part_cost:   25.00,
    total_part_cost:  25.00 * (def.quantity ?? 1),
    parts_markup_pct: 0.25,
    labor_hours:      1.0,
    labor_rate:       95.00,
    labor_cost:       95.00,
    subtotal:         round2(25.00 * (def.quantity ?? 1) * 1.25 + 95.00),
    source:           'rule',
    locked:           false,
    notes:            '',
    requires_site_assessment: false,
  }));

  const partsSubtotal = lineItems.reduce((s, li) => s + li.total_part_cost, 0);
  const laborSubtotal = lineItems.reduce((s, li) => s + li.labor_cost, 0);
  const markup        = round2(partsSubtotal * 0.25);
  const subtotal      = round2(partsSubtotal + markup + laborSubtotal);
  const tax           = round2(subtotal * 0.0875);

  return {
    quote_id:            `mock-quote-${Date.now()}`,
    company_id,
    customer_id,
    status:              'draft',
    line_items:          lineItems,
    summary: {
      parts_subtotal:    round2(partsSubtotal),
      labor_subtotal:    round2(laborSubtotal),
      parts_markup:      markup,
      volume_discount:   0,
      subtotal_before_tax: subtotal,
      tax_amount:        tax,
      total:             round2(subtotal + tax),
    },
    ai_generated_count:  0,
    rule_matched_count:  lineItems.length,
    created_at:          new Date().toISOString(),
    expires_at:          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ─── Process one job ──────────────────────────────────────────────────────────

export async function processQuoteJob(job) {
  const { inspection_id, quote_id, company_id, customer_id, deficiencies = [], options = {} } = job.payload;

  bus.emit(EventTypes.QUOTE_GENERATING, { inspection_id, quote_id, job_id: job.id },
    { correlation_id: job.correlation_id });

  let engineQuote;
  if (process.env.MOCK_WORKERS === 'true') {
    await new Promise(r => setTimeout(r, 10));
    engineQuote = mockQuoteResult({ deficiencies, company_id, customer_id });
  } else {
    const response = await fetch(`${QUOTE_SERVICE_URL}/v1/quote`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        company_id,
        customer_id,
        inspection_id,
        deficiencies,
        options,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Quote service error ${response.status}: ${text}`), {
        retryable: response.status >= 500,
      });
    }

    const json = await response.json();
    if (!json.success) throw new Error(`Quote generation failed: ${json.error?.message}`);
    engineQuote = json.data;
  }

  // Update workflow quote entity with engine result
  const wfQuote = quoteStore.get(quote_id);
  if (wfQuote) {
    quoteStore.set(quote_id, {
      ...wfQuote,
      line_items:      engineQuote.line_items,
      summary:         engineQuote.summary,
      engine_quote_id: engineQuote.quote_id,
      updated_at:      new Date().toISOString(),
    });
  }

  bus.emit(EventTypes.QUOTE_GENERATED, {
    inspection_id,
    quote_id,
    engine_quote_id: engineQuote.quote_id,
    job_id:          job.id,
    total:           engineQuote.summary?.total,
  }, { correlation_id: job.correlation_id });

  return engineQuote;
}

// ─── Worker loop ──────────────────────────────────────────────────────────────

export function startQuoteWorker() {
  if (_running) return;
  _running = true;

  _interval = setInterval(async () => {
    const job = queues.quote.dequeue();
    if (!job) return;

    try {
      await processQuoteJob(job);
      queues.quote.ack(job.id);
    } catch (err) {
      const result = queues.quote.nack(job.id, err.message);
      if (result === 'dlq') {
        bus.emit(EventTypes.QUOTE_FAILED, {
          inspection_id: job.payload.inspection_id,
          quote_id:      job.payload.quote_id,
          job_id:        job.id,
          error:         err.message,
          dlq:           true,
        }, { correlation_id: job.correlation_id });
      }
    }
  }, POLL_MS);

  _interval.unref?.();
}

export function stopQuoteWorker() {
  _running = false;
  if (_interval) { clearInterval(_interval); _interval = null; }
}
