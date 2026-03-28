/**
 * events.js — In-process event bus with outbox pattern
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │                      EVENT BUS DESIGN                                │
 * │                                                                      │
 * │  Publisher          Outbox              Bus             Subscribers  │
 * │  ─────────          ──────              ───             ───────────  │
 * │  emit(event) ──►  outbox[]  ──flush()──►  Map<type,   ──► handler() │
 * │                   (durable)             Set<handler>>               │
 * │                                                                      │
 * │  Outbox guarantees:                                                  │
 * │    - Events are buffered in memory before dispatch                   │
 * │    - Flush is called micro-task after emit (queueMicrotask)          │
 * │    - Failed handlers are retried up to HANDLER_MAX_RETRIES           │
 * │    - Undelivered events land in deadLetters for inspection           │
 * │    - In production: replace outbox[] with a DB table + polling       │
 * │      worker so events survive restarts (Transactional Outbox)        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Event naming convention:
 *   <domain>.<entity>.<past-tense-verb>
 *   e.g. inspection.created, voice.processed, quote.approved
 *
 * All events carry a standard envelope:
 *   {
 *     id:           UUID           — unique event ID
 *     type:         string         — event type
 *     payload:      object         — domain data
 *     correlation_id: string       — trace ID linking saga steps
 *     occurred_at:  ISO string     — when the domain action happened
 *     emitted_at:   number         — Unix ms, set by emit()
 *     version:      number         — schema version for consumers
 *   }
 */

import { randomUUID } from 'node:crypto';

const HANDLER_MAX_RETRIES = parseInt(process.env.EVENT_HANDLER_RETRIES ?? '2', 10);

// ─── Event catalogue (string constants for all known event types) ─────────────

export const EventTypes = Object.freeze({
  // Inspection lifecycle
  INSPECTION_CREATED:       'inspection.created',
  INSPECTION_VOICE_ADDED:   'inspection.voice_added',
  INSPECTION_IMAGE_ADDED:   'inspection.image_added',
  INSPECTION_SUBMITTED:     'inspection.submitted',
  INSPECTION_PROCESSING:    'inspection.processing',
  INSPECTION_COMPLETE:      'inspection.complete',
  INSPECTION_FAILED:        'inspection.failed',

  // Voice processing
  VOICE_QUEUED:             'voice.queued',
  VOICE_PROCESSING:         'voice.processing',
  VOICE_PROCESSED:          'voice.processed',
  VOICE_FAILED:             'voice.failed',

  // Image processing
  IMAGE_QUEUED:             'image.queued',
  IMAGE_PROCESSING:         'image.processing',
  IMAGE_PROCESSED:          'image.processed',
  IMAGE_FAILED:             'image.failed',

  // Report generation
  REPORT_QUEUED:            'report.queued',
  REPORT_GENERATING:        'report.generating',
  REPORT_GENERATED:         'report.generated',
  REPORT_FAILED:            'report.failed',

  // Quote lifecycle
  QUOTE_QUEUED:             'quote.queued',
  QUOTE_GENERATING:         'quote.generating',
  QUOTE_GENERATED:          'quote.generated',
  QUOTE_SENT:               'quote.sent',
  QUOTE_APPROVED:           'quote.approved',
  QUOTE_REJECTED:           'quote.rejected',
  QUOTE_FAILED:             'quote.failed',

  // Job scheduling
  JOB_SCHEDULED:            'job.scheduled',
  JOB_DISPATCHED:           'job.dispatched',
  JOB_COMPLETED:            'job.completed',
  JOB_CANCELLED:            'job.cancelled',

  // Notifications
  NOTIFICATION_QUEUED:      'notification.queued',
  NOTIFICATION_SENT:        'notification.sent',
  NOTIFICATION_FAILED:      'notification.failed',
});

// ─── EventBus class ────────────────────────────────────────────────────────────

export class EventBus {
  /** @type {Map<string, Set<Function>>} */
  #handlers     = new Map();
  /** @type {Array<object>}  In-memory outbox buffer */
  #outbox       = [];
  /** @type {Array<object>}  Dead-letter store for failed events */
  #deadLetters  = [];
  /** @type {Array<object>}  Full event history for inspection/replay */
  #eventLog     = [];
  #flushing     = false;
  #flushPending = false;

  // ─── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to one or more event types.
   *
   * @param {string|string[]}  eventType  Event type string(s) or '*' for all
   * @param {Function}         handler    async (event) => void
   * @returns {Function}                  Unsubscribe function
   */
  on(eventType, handler) {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    for (const t of types) {
      if (!this.#handlers.has(t)) this.#handlers.set(t, new Set());
      this.#handlers.get(t).add(handler);
    }
    return () => this.off(eventType, handler);
  }

  /** Subscribe once — auto-removes after first delivery */
  once(eventType, handler) {
    const wrapper = async (event) => {
      this.off(eventType, wrapper);
      await handler(event);
    };
    return this.on(eventType, wrapper);
  }

  /** Unsubscribe a handler */
  off(eventType, handler) {
    const types = Array.isArray(eventType) ? eventType : [eventType];
    for (const t of types) {
      this.#handlers.get(t)?.delete(handler);
    }
  }

  // ─── Publish ───────────────────────────────────────────────────────────────

  /**
   * Emit an event — buffers into outbox and schedules async flush.
   *
   * @param {string} type            Event type (use EventTypes constants)
   * @param {object} payload         Domain data
   * @param {object} [opts]
   * @param {string} [opts.correlation_id]
   * @param {number} [opts.version]
   * @returns {object}               The event envelope
   */
  emit(type, payload = {}, opts = {}) {
    const event = {
      id:             randomUUID(),
      type,
      payload,
      correlation_id: opts.correlation_id ?? null,
      occurred_at:    new Date().toISOString(),
      emitted_at:     Date.now(),
      version:        opts.version ?? 1,
    };

    this.#outbox.push(event);
    this.#eventLog.push(event);
    this.#scheduleFlush();
    return event;
  }

  // ─── Flush ─────────────────────────────────────────────────────────────────

  #scheduleFlush() {
    if (this.#flushPending) return;
    this.#flushPending = true;
    queueMicrotask(() => this.#flush());
  }

  async #flush() {
    // Always clear the pending flag — the active flush (or this one) will handle the outbox.
    // Leaving it true while returning early causes drain() to loop forever.
    this.#flushPending = false;
    if (this.#flushing) return;
    this.#flushing = true;

    while (this.#outbox.length > 0) {
      const batch = this.#outbox.splice(0, this.#outbox.length);
      for (const event of batch) {
        await this.#dispatch(event);
      }
    }

    this.#flushing = false;
  }

  async #dispatch(event) {
    const subs = [
      ...(this.#handlers.get(event.type) ?? []),
      ...(this.#handlers.get('*')        ?? []),
    ];

    if (subs.length === 0) return;

    await Promise.all(subs.map(handler => this.#invokeWithRetry(handler, event)));
  }

  async #invokeWithRetry(handler, event, attempt = 0) {
    try {
      await handler(event);
    } catch (err) {
      if (attempt < HANDLER_MAX_RETRIES) {
        // Exponential backoff between retries (non-blocking via setTimeout)
        await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
        return this.#invokeWithRetry(handler, event, attempt + 1);
      }
      // Give up — record in dead letter store
      this.#deadLetters.push({
        event,
        handler: handler.name || '(anonymous)',
        error:   err?.message ?? String(err),
        failed_at: Date.now(),
      });
    }
  }

  // ─── Inspection / test helpers ─────────────────────────────────────────────

  /** Wait for all pending microtask flushes to complete (useful in tests) */
  async drain() {
    // Spin until outbox is empty and no flush is running
    while (this.#outbox.length > 0 || this.#flushing || this.#flushPending) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  /** Replay all events of a given type to a new subscriber (catch-up) */
  replay(type, handler) {
    const matching = this.#eventLog.filter(e => e.type === type || type === '*');
    for (const event of matching) {
      handler(event).catch(() => {});
    }
  }

  /** Return all events emitted during this session */
  eventLog(filter) {
    if (!filter) return [...this.#eventLog];
    return this.#eventLog.filter(e => filter(e));
  }

  /** Return dead-lettered handler failures */
  deadLetters() {
    return [...this.#deadLetters];
  }

  stats() {
    return {
      handlers:    [...this.#handlers.entries()].map(([t, s]) => ({ type: t, count: s.size })),
      outboxDepth: this.#outbox.length,
      eventCount:  this.#eventLog.length,
      deadLetters: this.#deadLetters.length,
    };
  }

  /** Clear event log and dead letters (useful between tests) */
  reset() {
    this.#handlers.clear();
    this.#outbox.length     = 0;
    this.#eventLog.length   = 0;
    this.#deadLetters.length = 0;
    this.#flushing     = false;
    this.#flushPending = false;
  }
}

// ─── Singleton bus ─────────────────────────────────────────────────────────────

export const bus = new EventBus();
