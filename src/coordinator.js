/**
 * coordinator.js — Saga orchestrator
 *
 * The coordinator subscribes to domain events and drives the end-to-end
 * inspection workflow by applying state transitions and enqueuing the
 * next unit of work.
 *
 * ─── Full workflow saga ───────────────────────────────────────────────────────
 *
 *  1. Inspection CREATED (draft)
 *     └─ Nothing yet — waits for technician to add recordings/images
 *
 *  2. Inspection SUBMITTED (→ processing)
 *     ├─ Enqueue voice jobs for each unprocessed recording
 *     └─ Enqueue image jobs for each unprocessed image
 *
 *  3. VOICE_PROCESSED / IMAGE_PROCESSED
 *     └─ If all media processed → enqueue report job
 *
 *  4. REPORT_GENERATED
 *     ├─ Transition inspection → complete
 *     ├─ Create quote entity (draft)
 *     ├─ Enqueue quote job
 *     └─ Notify technician: inspection complete
 *
 *  5. QUOTE_GENERATED
 *     ├─ Transition quote → review (awaiting admin)
 *     └─ Notify admin: quote ready for review
 *
 *  6. QUOTE_APPROVED (by admin via API)
 *     ├─ Transition quote → sent
 *     ├─ Enqueue notify → customer
 *     └─ Notify customer: quote sent
 *
 *  7. QUOTE_ACCEPTED (customer approves)
 *     ├─ Transition quote → accepted
 *     ├─ Create job entity (pending → scheduled)
 *     └─ Notify company: job scheduled
 *
 *  Failure paths:
 *     VOICE_FAILED / IMAGE_FAILED / REPORT_FAILED → inspection → failed
 *     QUOTE_FAILED → quote → failed
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID }        from 'node:crypto';
import { bus, EventTypes }   from './events.js';
import { queues }            from './queue.js';
import {
  InspectionMachine, QuoteMachine, JobMachine,
  inspectionStore, quoteStore, jobStore,
  createQuote, createJob,
} from './state.js';

// ─── Helper: check if all media is processed ─────────────────────────────────

function allMediaProcessed(inspection) {
  const voices = inspection.voice_recordings ?? [];
  const images = inspection.images ?? [];
  if (voices.length === 0 && images.length === 0) return false;
  return (
    voices.every(r => r.processed) &&
    images.every(img => img.processed)
  );
}

// ─── Helper: enqueue notification ────────────────────────────────────────────

function enqueueNotification({ channel, recipient, template, data, metadata, correlationId }) {
  if (!recipient) return;   // Skip if no contact info provided
  queues.notify.enqueue({
    type:           'notify',
    priority:       7,          // Low — notifications are best-effort
    payload:        { channel, recipient, template, data, metadata },
    correlation_id: correlationId,
    idempotency_key: `notify.${template}.${JSON.stringify(metadata)}`,
  });
}

// ─── Saga handlers ────────────────────────────────────────────────────────────

function handleInspectionSubmitted(event) {
  const { inspection_id } = event.payload;
  const inspection = inspectionStore.get(inspection_id);
  if (!inspection) return;

  // Transition to processing
  try {
    inspectionStore.applyTransition(inspection_id, InspectionMachine, 'begin_processing');
  } catch (_) { return; }

  const correlationId = event.correlation_id ?? inspection_id;

  // Enqueue voice jobs
  for (const rec of inspection.voice_recordings ?? []) {
    if (rec.processed) continue;
    queues.voice.enqueue({
      type:            'voice',
      priority:        2,
      payload:         {
        inspection_id,
        recording_id:  rec.id,
        transcript:    rec.transcript,
        context:       rec.context ?? {},
      },
      correlation_id:  correlationId,
      idempotency_key: `voice.${rec.id}`,
    });
  }

  // Enqueue image jobs
  for (const img of inspection.images ?? []) {
    if (img.processed) continue;
    queues.image.enqueue({
      type:           'image',
      priority:       2,
      payload:        {
        inspection_id,
        image_id:     img.id,
        image:        img.image,
        context:      img.context ?? {},
      },
      correlation_id: correlationId,
      idempotency_key: `image.${img.id}`,
    });
  }

  bus.emit(EventTypes.INSPECTION_PROCESSING, { inspection_id }, { correlation_id: correlationId });
}

function handleMediaProcessed(event) {
  const { inspection_id } = event.payload;
  const inspection = inspectionStore.get(inspection_id);
  if (!inspection) return;
  if (inspection.state !== 'processing') return;

  if (!allMediaProcessed(inspection)) return;   // Still waiting on other media

  const correlationId = event.correlation_id ?? inspection_id;
  const reportId = randomUUID();

  // Pre-assign the report ID on the inspection
  inspectionStore.set(inspection_id, {
    ...inspection,
    report_id: reportId,
    updated_at: new Date().toISOString(),
  });

  // Enqueue report generation
  queues.report.enqueue({
    type:           'report',
    priority:       3,
    payload:        { inspection_id, report_id: reportId },
    correlation_id: correlationId,
    idempotency_key: `report.${inspection_id}`,
  });

  bus.emit(EventTypes.REPORT_QUEUED, { inspection_id, report_id: reportId },
    { correlation_id: correlationId });
}

function handleReportGenerated(event) {
  const { inspection_id } = event.payload;
  const inspection = inspectionStore.get(inspection_id);
  if (!inspection) return;

  const correlationId = event.correlation_id ?? inspection_id;

  // Transition inspection → complete
  try {
    inspectionStore.applyTransition(inspection_id, InspectionMachine, 'complete');
  } catch (_) { return; }

  bus.emit(EventTypes.INSPECTION_COMPLETE, { inspection_id }, { correlation_id: correlationId });

  // Create quote entity
  const wfQuote = createQuote({
    company_id:    inspection.company_id,
    customer_id:   inspection.customer_id,
    inspection_id,
  });

  // Link quote to inspection
  inspectionStore.set(inspection_id, {
    ...inspectionStore.get(inspection_id),
    quote_id:   wfQuote.id,
    updated_at: new Date().toISOString(),
  });

  // Enqueue quote generation
  queues.quote.enqueue({
    type:           'quote',
    priority:       3,
    payload:        {
      inspection_id,
      quote_id:      wfQuote.id,
      company_id:    inspection.company_id,
      customer_id:   inspection.customer_id,
      deficiencies:  inspection.deficiencies ?? [],
    },
    correlation_id:  correlationId,
    idempotency_key: `quote.${inspection_id}`,
  });

  bus.emit(EventTypes.QUOTE_QUEUED, { inspection_id, quote_id: wfQuote.id },
    { correlation_id: correlationId });

  // Notify technician
  enqueueNotification({
    channel:       'email',
    recipient:     inspection.technician_email,
    template:      'inspection.complete',
    data:          { inspection_id, deficiency_count: (inspection.deficiencies ?? []).length },
    metadata:      { inspection_id },
    correlationId,
  });
}

function handleQuoteGenerated(event) {
  const { quote_id, total } = event.payload;
  const wfQuote = quoteStore.get(quote_id);
  if (!wfQuote) return;

  const correlationId = event.correlation_id ?? quote_id;

  // Transition quote draft → review
  try {
    quoteStore.applyTransition(quote_id, QuoteMachine, 'generate');   // → generating
    quoteStore.applyTransition(quote_id, QuoteMachine, 'complete');   // → review
  } catch (_) { return; }

  // Notify admin
  const inspection = inspectionStore.get(wfQuote.inspection_id);
  enqueueNotification({
    channel:       'email',
    recipient:     inspection?.admin_email,
    template:      'quote.ready',
    data:          { quote_id, total, inspection_id: wfQuote.inspection_id },
    metadata:      { quote_id, inspection_id: wfQuote.inspection_id },
    correlationId,
  });
}

function handleQuoteApproved(event) {
  // Called when admin explicitly approves via the PUT /v1/quote/:id/approve endpoint
  const { quote_id } = event.payload;
  const wfQuote = quoteStore.get(quote_id);
  if (!wfQuote) return;

  const correlationId = event.correlation_id ?? quote_id;

  // Transition quote → sent
  try {
    quoteStore.applyTransition(quote_id, QuoteMachine, 'approve');
  } catch (_) { return; }

  const inspection = inspectionStore.get(wfQuote.inspection_id);

  // Notify customer
  enqueueNotification({
    channel:       'email',
    recipient:     wfQuote.customer_email ?? inspection?.customer_email,
    template:      'quote.sent',
    data:          {
      quote_id,
      customer_email: wfQuote.customer_email ?? inspection?.customer_email,
      total:          wfQuote.summary?.total,
    },
    metadata:      { quote_id, inspection_id: wfQuote.inspection_id },
    correlationId,
  });
}

function handleQuoteAccepted(event) {
  const { quote_id } = event.payload;
  const wfQuote = quoteStore.get(quote_id);
  if (!wfQuote) return;

  const correlationId = event.correlation_id ?? quote_id;

  // Transition quote sent → accepted
  try {
    quoteStore.applyTransition(quote_id, QuoteMachine, 'customer_approve');
  } catch (_) { return; }

  // Create job
  const inspection = inspectionStore.get(wfQuote.inspection_id);
  const job = createJob({
    company_id:    wfQuote.company_id,
    customer_id:   wfQuote.customer_id,
    inspection_id: wfQuote.inspection_id,
    quote_id,
    scheduled_date: null,   // TBD — scheduling happens separately
  });

  // Transition job pending → scheduled (once a date is set, for now stay pending)
  // In production, a separate scheduling saga would handle this

  bus.emit(EventTypes.JOB_SCHEDULED, {
    job_id:        job.id,
    quote_id,
    inspection_id: wfQuote.inspection_id,
    company_id:    wfQuote.company_id,
  }, { correlation_id: correlationId });

  // Notify company
  enqueueNotification({
    channel:       'email',
    recipient:     inspection?.admin_email,
    template:      'quote.approved',
    data:          {
      quote_id,
      total:         wfQuote.summary?.total,
    },
    metadata:      { quote_id, job_id: job.id },
    correlationId,
  });
}

function handleFailure(eventType, event) {
  const { inspection_id, quote_id, job_id: wfJobId, error } = event.payload;

  if (inspection_id) {
    const inspection = inspectionStore.get(inspection_id);
    if (inspection && InspectionMachine.canTransition(inspection.state, 'fail')) {
      inspectionStore.applyTransition(inspection_id, InspectionMachine, 'fail',
        { last_error: error });
      bus.emit(EventTypes.INSPECTION_FAILED, { inspection_id, error },
        { correlation_id: event.correlation_id });
    }
  }

  if (quote_id) {
    const wfQuote = quoteStore.get(quote_id);
    if (wfQuote && QuoteMachine.canTransition(wfQuote.state, 'fail')) {
      quoteStore.applyTransition(quote_id, QuoteMachine, 'fail',
        { last_error: error });
      bus.emit(EventTypes.QUOTE_FAILED, { quote_id, error },
        { correlation_id: event.correlation_id });
    }
  }
}

// ─── Wire up subscriptions ────────────────────────────────────────────────────

let _subscriptions = [];

export function startCoordinator() {
  if (_subscriptions.length > 0) return;   // Already started

  _subscriptions = [
    bus.on(EventTypes.INSPECTION_SUBMITTED,  handleInspectionSubmitted),
    bus.on(EventTypes.VOICE_PROCESSED,       handleMediaProcessed),
    bus.on(EventTypes.IMAGE_PROCESSED,       handleMediaProcessed),
    bus.on(EventTypes.REPORT_GENERATED,      handleReportGenerated),
    bus.on(EventTypes.QUOTE_GENERATED,       handleQuoteGenerated),
    bus.on(EventTypes.QUOTE_APPROVED,        handleQuoteApproved),
    bus.on(EventTypes.QUOTE_ACCEPTED,        handleQuoteAccepted),   // customer approves

    // Failure handlers
    bus.on(EventTypes.VOICE_FAILED,          e => handleFailure('voice',   e)),
    bus.on(EventTypes.IMAGE_FAILED,          e => handleFailure('image',   e)),
    bus.on(EventTypes.REPORT_FAILED,         e => handleFailure('report',  e)),
    bus.on(EventTypes.QUOTE_FAILED,          e => handleFailure('quote',   e)),
  ];
}

export function stopCoordinator() {
  for (const unsub of _subscriptions) unsub();
  _subscriptions = [];
}

// ─── Public helpers (used by API server) ─────────────────────────────────────

/**
 * Submit an inspection for processing.
 * Caller has already attached recordings/images to the inspection entity.
 */
export function submitInspection(inspectionId) {
  const inspection = inspectionStore.get(inspectionId);
  if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);

  inspectionStore.applyTransition(inspectionId, InspectionMachine, 'submit');

  bus.emit(EventTypes.INSPECTION_SUBMITTED,
    { inspection_id: inspectionId },
    { correlation_id: inspectionId });

  return inspectionStore.get(inspectionId);
}

/**
 * Admin approves a quote — moves it to SENT and notifies customer.
 */
export function approveQuote(quoteId) {
  const wfQuote = quoteStore.get(quoteId);
  if (!wfQuote) throw new Error(`Quote ${quoteId} not found`);

  bus.emit(EventTypes.QUOTE_APPROVED,
    { quote_id: quoteId },
    { correlation_id: wfQuote.inspection_id });

  return quoteStore.get(quoteId);
}

/**
 * Customer accepts a quote — triggers job creation.
 */
export function acceptQuote(quoteId) {
  const wfQuote = quoteStore.get(quoteId);
  if (!wfQuote) throw new Error(`Quote ${quoteId} not found`);

  bus.emit(EventTypes.QUOTE_ACCEPTED,
    { quote_id: quoteId },
    { correlation_id: wfQuote.inspection_id });

  return quoteStore.get(quoteId);
}

/**
 * Customer rejects a quote.
 */
export function rejectQuote(quoteId, reason = '') {
  const wfQuote = quoteStore.get(quoteId);
  if (!wfQuote) throw new Error(`Quote ${quoteId} not found`);

  quoteStore.applyTransition(quoteId, QuoteMachine, 'customer_reject', { rejection_reason: reason });

  bus.emit(EventTypes.QUOTE_REJECTED,
    { quote_id: quoteId, reason },
    { correlation_id: wfQuote.inspection_id });

  return quoteStore.get(quoteId);
}
