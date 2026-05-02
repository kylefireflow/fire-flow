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
  'inspection.complete': (data) => ({
    subject: 'Inspection Complete — Results Ready',
    text: `Inspection ${data.inspection_id} has been processed. ` +
          `${data.deficiency_count} deficiency(ies) found.`,
  }),

  'quote.ready': (data) => ({
    subject: `Quote Ready for Review — $${data.total?.toFixed(2) ?? 'TBD'}`,
    text: `Quote ${data.quote_id} is ready for admin review. ` +
          `Total: $${data.total?.toFixed(2) ?? 'TBD'}`,
  }),

  'quote.sent': (data) => ({
    subject: 'Your Fire Suppression Repair Quote',
    text: `You have a new repair quote (${data.quote_id}). ` +
          `Total: $${data.total?.toFixed(2) ?? 'TBD'}. ` +
          `View and approve your quote here: ${data.customer_url ?? '(link unavailable)'}`,
    html: renderQuoteSentHtml(data),
  }),

  'quote.approved': (data) => ({
    subject: 'Quote Approved by Customer',
    text: `Customer approved quote ${data.quote_id}. ` +
          `Total: $${data.total?.toFixed(2) ?? 'TBD'}. A job has been scheduled.`,
  }),

  'job.scheduled': (data) => ({
    subject: `New Job Assigned — ${data.address ?? 'Address TBD'}`,
    text: `New job scheduled for ${data.scheduled_date ?? 'TBD'} at ${data.address ?? 'unknown address'}.`,
  }),
};

function renderQuoteSentHtml(data) {
  const total = data.total != null ? `$${data.total.toFixed(2)}` : null;
  const url   = data.customer_url ?? '#';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background:#dc2626;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Fire Flow</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Your Repair Quote is Ready</h2>
            <p style="margin:0 0 24px;font-size:15px;color:#52525b;line-height:1.6;">
              We've prepared a repair quote for the deficiencies found during your fire suppression inspection.
              Please review the details and let us know how you'd like to proceed.
            </p>
            ${total ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;background:#fafafa;border-radius:6px;border:1px solid #e4e4e7;">
              <tr>
                <td style="padding:16px 20px;">
                  <span style="font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;">Quote Total</span><br>
                  <span style="font-size:28px;font-weight:700;color:#18181b;">${total}</span>
                </td>
                <td align="right" style="padding:16px 20px;">
                  <span style="font-size:13px;color:#71717a;">Quote ID</span><br>
                  <span style="font-size:14px;color:#52525b;font-family:monospace;">${data.quote_id?.slice(0, 8) ?? '—'}…</span>
                </td>
              </tr>
            </table>` : ''}
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center" style="padding:4px 0 16px;">
                <a href="${url}" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:16px;font-weight:600;padding:14px 32px;border-radius:6px;text-decoration:none;">
                  View &amp; Approve Quote
                </a>
              </td></tr>
            </table>
            <p style="margin:16px 0 0;font-size:13px;color:#a1a1aa;line-height:1.5;">
              This link will expire in 30 days. If you have questions, reply to this email or contact us directly.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;background:#fafafa;border-top:1px solid #e4e4e7;">
            <p style="margin:0;font-size:12px;color:#a1a1aa;">
              Sent by Fire Flow · Fire suppression inspection &amp; repair
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderTemplate(template, data) {
  const render = TEMPLATES[template];
  if (render) return render(data);
  return { text: `Notification: ${template} — ${JSON.stringify(data)}` };
}

// ─── Channel senders ─────────────────────────────────────────────────────────

async function sendEmail(recipient, subject, { text, html } = {}) {
  if (process.env.MOCK_WORKERS === 'true') {
    console.log(`[MOCK EMAIL] To: ${recipient} | ${subject}`);
    return { provider: 'mock', message_id: `mock-email-${Date.now()}` };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not set — cannot send email');

  const from = process.env.FROM_EMAIL ?? 'Fire Flow <noreply@fireflow.app>';

  const payload = {
    from,
    to:      [recipient],
    subject,
    text:    text ?? '',
  };
  if (html) payload.html = html;

  const response = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body:   JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    console.error(`[EMAIL] Resend API error ${response.status} for ${recipient}: ${err}`);
    throw new Error(`Resend API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  console.log(`[EMAIL] Sent to ${recipient} via Resend — message_id=${result.id} subject="${subject}"`);
  return { provider: 'resend', message_id: result.id };
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

  const rendered = renderTemplate(template, data);
  const body     = typeof rendered === 'string' ? rendered : rendered.text;
  let result;

  switch (channel) {
    case 'email': {
      const subject = rendered.subject ?? `Fire Flow: ${template}`;
      result = await sendEmail(recipient, subject, { text: body, html: rendered.html });
      break;
    }
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
      console.error(`[NOTIFY] Job ${job.id} (${job.payload?.channel} → ${job.payload?.recipient}) failed: ${err.message}`);
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
