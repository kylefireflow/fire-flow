/**
 * queue.js — Priority job queue with retry and dead-letter queue
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     QUEUE DESIGN                                │
 * │                                                                 │
 * │  PRODUCER               QUEUE                   CONSUMER       │
 * │  ────────               ─────                   ────────       │
 * │  enqueue(job)  ──────►  PENDING ──dequeue()──►  Worker         │
 * │                         INFLIGHT ◄─────────────  Worker        │
 * │                              │  ack(id)  ──────►  [done]       │
 * │                              │  nack(id) ──────►  PENDING      │
 * │                              │  (attempts < max)  + backoff    │
 * │                              │  nack(id) ──────►  DLQ          │
 * │                              │  (attempts == max) [manual fix] │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Reliability guarantees:
 *   - Idempotency: duplicate enqueues (same idempotency_key) are no-ops.
 *   - At-least-once delivery: nack'd jobs are retried with backoff.
 *   - Visibility timeout: inflight jobs not ack'd within VISIBILITY_MS
 *     are automatically returned to PENDING (simulates SQS visibility timeout).
 *   - Dead-letter queue: jobs exceeding max_attempts land in DLQ for
 *     manual inspection/replay.
 *
 * In production, swap the in-memory Map for Redis ZSET (sorted by
 * next_attempt_at score) or AWS SQS for horizontal scaling.
 *
 * Job priority: 1 = highest (processed first), 10 = lowest.
 */

import { randomUUID } from 'node:crypto';

const VISIBILITY_TIMEOUT_MS = parseInt(process.env.QUEUE_VISIBILITY_MS ?? '30000', 10);
const DEFAULT_MAX_ATTEMPTS  = parseInt(process.env.QUEUE_MAX_ATTEMPTS  ?? '3',     10);
const BACKOFF_BASE_MS       = parseInt(process.env.QUEUE_BACKOFF_MS    ?? '2000',  10);

// ─── Job type ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Job
 * @property {string}   id               Unique job ID (UUID)
 * @property {string}   type             Job type, e.g. 'ai.voice', 'ai.image'
 * @property {object}   payload          Arbitrary job data
 * @property {number}   priority         1–10, lower = higher priority
 * @property {number}   attempts         How many times this job has been attempted
 * @property {number}   max_attempts     Max before DLQ
 * @property {number}   created_at       Unix timestamp ms
 * @property {number}   next_attempt_at  Unix timestamp ms (delayed retry)
 * @property {string}   [idempotency_key] Optional dedup key
 * @property {string}   [correlation_id]  Trace ID linking related jobs
 * @property {string[]} [errors]          Accumulated error messages
 */

export class Queue {
  #name;
  #pending   = new Map();   // id → Job (sorted by priority+next_attempt_at on poll)
  #inflight  = new Map();   // id → { job, inflight_since }
  #dlq       = new Map();   // id → Job
  #idempKeys = new Map();   // idempotency_key → job id

  constructor(name = 'default') {
    this.#name = name;

    // Visibility timeout sweep — redeliver stuck inflight jobs
    setInterval(() => this.#sweepVisibilityTimeouts(), Math.min(VISIBILITY_TIMEOUT_MS / 2, 5000)).unref();
  }

  get name() { return this.#name; }

  // ─── Producer API ───────────────────────────────────────────────────────────

  /**
   * Add a job to the queue.
   * @param {object} opts
   * @returns {Job} The enqueued job (or existing job if idempotency key matches)
   */
  enqueue({
    type,
    payload       = {},
    priority      = 5,
    max_attempts  = DEFAULT_MAX_ATTEMPTS,
    delay_ms      = 0,
    idempotency_key,
    correlation_id,
  }) {
    // Idempotency: return existing job if key matches
    if (idempotency_key) {
      const existingId = this.#idempKeys.get(idempotency_key);
      if (existingId) {
        return (
          this.#pending.get(existingId) ??
          this.#inflight.get(existingId)?.job ??
          this.#dlq.get(existingId)
        );
      }
    }

    const now = Date.now();
    const job = {
      id:              randomUUID(),
      type,
      payload,
      priority:        Math.max(1, Math.min(10, priority)),
      attempts:        0,
      max_attempts,
      created_at:      now,
      next_attempt_at: now + delay_ms,
      idempotency_key,
      correlation_id,
      errors:          [],
    };

    this.#pending.set(job.id, job);
    if (idempotency_key) this.#idempKeys.set(idempotency_key, job.id);

    return job;
  }

  // ─── Consumer API ───────────────────────────────────────────────────────────

  /**
   * Dequeue the next available job (respects priority and next_attempt_at).
   * @returns {Job|null}
   */
  dequeue() {
    const now = Date.now();
    let best  = null;

    for (const job of this.#pending.values()) {
      if (job.next_attempt_at > now) continue;  // not ready yet
      if (!best) { best = job; continue; }
      // Lower priority number = higher urgency
      if (job.priority < best.priority) { best = job; continue; }
      if (job.priority === best.priority && job.created_at < best.created_at) best = job;
    }

    if (!best) return null;

    this.#pending.delete(best.id);
    this.#inflight.set(best.id, { job: best, inflight_since: now });
    best.attempts++;
    return best;
  }

  /**
   * Acknowledge successful job completion.
   */
  ack(jobId) {
    const entry = this.#inflight.get(jobId);
    if (!entry) return false;
    this.#inflight.delete(jobId);
    if (entry.job.idempotency_key) this.#idempKeys.delete(entry.job.idempotency_key);
    return true;
  }

  /**
   * Negative-acknowledge — retry or dead-letter depending on attempts.
   * @param {string} jobId
   * @param {string} reason   Error message
   */
  nack(jobId, reason = 'unknown error') {
    const entry = this.#inflight.get(jobId);
    if (!entry) return false;

    const job = entry.job;
    this.#inflight.delete(jobId);
    job.errors = [...(job.errors ?? []), reason];

    if (job.attempts >= job.max_attempts) {
      // Move to DLQ
      this.#dlq.set(job.id, { ...job, dead_lettered_at: Date.now() });
      if (job.idempotency_key) this.#idempKeys.delete(job.idempotency_key);
      return 'dlq';
    }

    // Exponential backoff: base * 2^(attempts-1) + jitter
    const backoff = BACKOFF_BASE_MS * 2 ** (job.attempts - 1) + Math.random() * 500;
    job.next_attempt_at = Date.now() + Math.min(backoff, 60_000);
    this.#pending.set(job.id, job);
    return 'retry';
  }

  // ─── DLQ management ─────────────────────────────────────────────────────────

  /** List all dead-lettered jobs */
  listDlq() {
    return [...this.#dlq.values()];
  }

  /**
   * Replay a DLQ job — resets attempts and re-enqueues it.
   */
  replayDlq(jobId) {
    const job = this.#dlq.get(jobId);
    if (!job) return null;
    this.#dlq.delete(jobId);
    job.attempts         = 0;
    job.errors           = [];
    job.next_attempt_at  = Date.now();
    job.dead_lettered_at = undefined;
    this.#pending.set(job.id, job);
    if (job.idempotency_key) this.#idempKeys.set(job.idempotency_key, job.id);
    return job;
  }

  // ─── Inspection / stats ─────────────────────────────────────────────────────

  stats() {
    return {
      queue:    this.#name,
      pending:  this.#pending.size,
      inflight: this.#inflight.size,
      dlq:      this.#dlq.size,
    };
  }

  pendingCount()  { return this.#pending.size; }
  inflightCount() { return this.#inflight.size; }
  dlqCount()      { return this.#dlq.size; }

  hasPending(jobId) { return this.#pending.has(jobId); }
  hasInflight(jobId){ return this.#inflight.has(jobId); }

  /** Drain all pending jobs — useful for tests */
  drain() {
    const drained = [...this.#pending.values()];
    this.#pending.clear();
    return drained;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  #sweepVisibilityTimeouts() {
    const cutoff = Date.now() - VISIBILITY_TIMEOUT_MS;
    for (const [id, { job, inflight_since }] of this.#inflight) {
      if (inflight_since < cutoff) {
        this.#inflight.delete(id);
        job.next_attempt_at = Date.now();
        job.errors = [...(job.errors ?? []), 'visibility timeout — worker may have crashed'];
        this.#pending.set(id, job);
      }
    }
  }
}

// ─── Named queues ─────────────────────────────────────────────────────────────
// Each queue type corresponds to a distinct worker pool in production.

export const queues = {
  /** AI voice processing — high priority, CPU/GPU bound */
  voice:    new Queue('ai.voice'),
  /** AI image processing — high priority, GPU bound */
  image:    new Queue('ai.image'),
  /** Report generation — medium priority, CPU bound */
  report:   new Queue('report'),
  /** Quote generation — medium priority, I/O bound */
  quote:    new Queue('quote'),
  /** Customer/admin notifications — low priority, network bound */
  notify:   new Queue('notify'),
  /** Job scheduling — low priority */
  schedule: new Queue('schedule'),
};
