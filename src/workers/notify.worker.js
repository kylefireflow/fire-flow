/**
 * notify.worker.js — Sends notifications (email, SMS, webhook, push)
 *
 * Job payload:
 *   {
 *     channel:     'email' | 'sms' | 'webhook' | 'push'
 *     recipient:   string             — email, phone, URL, or device token
 *     template:    string             — template key
 *     data:        object             — template variables
 *     metadata:    object             — optional (inspection_id, quote_id, etc.)
 *   }
 *
 * Templates:
 *   inspection.complete  — notify technician inspection fully processed
 *   quote.ready          — notify admin quote is ready for review
 *   quote.sent           — notify customer quote has been sent
 *   quote.approved       — notify company quote was approved
 *   job.scheduled        — notify technician of new job
 *
 * On success:  emits NOTIFICATION_SENT
 * On failure:  nack → retry, or DLQ → emits NOTIFICATION_FAILED
 */

import { queues }            from '../queue.js';
import { bus, EventTypes }   from '../events.js';

// MOCK_WORKERS checked at runtime via process.env

let _running  = false;
let _interval = null;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? '500', 10);

// ─── Notification templates ───────────────────────────────────────────────────

const TEMPLATES = {
  'inspection.complete': (data) =>
    `Inspection ${data.inspection_id} has been processed. ` +
    `${data.deficiency_count} deficiencie(s) found.`,

  'quote.ready': (data) =>
    `Quote ${data.quote_id} is ready for admin review. ` +
    `Total: $${data.total?.toFixed(2) ?? 'TBD'}`,

  'quote.sent': (data) =>
    `Your repair quote has been sent to ${data.customer_email ?? 'the customer'}. ` +
    `Quote ID: ${data.quote_id}`,

  'quote.approved': (data) =>
    `Customer approved quote ${data.quote_id}. ` +
    `Total: $${data.total?.toFixed(2) ?? 'TBD'}. A job has been scheduled.`,

  'job.scheduled': (data) =>
    `New job scheduled for ${data.scheduled_date ?? 'TBD'} at ${data.address ?? 'unknown address'}.`,
};

function renderTemplate(template, data) {
  const render = TEMPLATES[template];
  if (render) return render(data);
  return `Notification: ${template} — ${JSON.stringify(data)}`;
}

// ─── Channel senders (stubbed — swap with real providers) ─────────────────────

async function sendEmail(recipient, subject, body) {
  if (process.env.MOCK_WORKERS === 'true') {
    // console.log(`[MOCK EMAIL] To: ${recipient}\n${subject}\n${body}`);
    return { provider: 'mock', message_id: `mock-email-${Date.now()}` };
  }
  // Real: integrate SendGrid / SES / Postmark
  throw new Error('Email provider not configured');
}

async function sendSms(recipient, body) {
  if (process.env.MOCK_WORKERS === 'true') {
    return { provider: 'mock', message_id: `mock-sms-${Date.now()}` };
  }
  throw new Error('SMS provider not configured');
}

async function sendWebhook(url, payload) {
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Webhook ${url} returned ${response.status}`);
  return { provider: 'webhook', status: response.status };
}

// ─── Process one job ──────────────────────────────────────────────────────────

export async function processNotifyJob(job) {
  const { channel, recipient, template, data = {}, metadata = {} } = job.payload;

  const body = renderTemplate(template, data);
  let result;

  switch (channel) {
    case 'email':
      result = await sendEmail(recipient, `Fire Flow: ${template}`, body);
      break;
    case 'sms':
      result = await sendSms(recipient, body);
      break;
    case 'webhook':
      result = await sendWebhook(recipient, { event: template, data, metadata });
      break;
    default:
      throw new Error(`Unknown notification channel: ${channel}`);
  }

  bus.emit(EventTypes.NOTIFICATION_SENT, {
    channel,
    recipient,
    template,
    message_id: result.message_id ?? null,
    ...metadata,
  }, { correlation_id: job.correlation_id });

  return result;
}

// ─── Worker loop ──────────────────────────────────────────────────────────────

export function startNotifyWorker() {
  if (_running) return;
  _running = true;

  _interval = setInterval(async () => {
    const job = queues.notify.dequeue();
    if (!job) return;

    try {
      await processNotifyJob(job);
      queues.notify.ack(job.id);
    } catch (err) {
      const result = queues.notify.nack(job.id, err.message);
      if (result === 'dlq') {
        bus.emit(EventTypes.NOTIFICATION_FAILED, {
          channel:   job.payload.channel,
          recipient: job.payload.recipient,
          template:  job.payload.template,
          job_id:    job.id,
          error:     err.message,
          dlq:       true,
        }, { correlation_id: job.correlation_id });
      }
    }
  }, POLL_MS);

  _interval.unref?.();
}

export function stopNotifyWorker() {
  _running = false;
  if (_interval) { clearInterval(_interval); _interval = null; }
}
