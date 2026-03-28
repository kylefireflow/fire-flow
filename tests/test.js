/**
 * tests/test.js — Workflow Engine test suite
 *
 * Covers:
 *   - Queue: enqueue, dequeue, ack, nack, DLQ, idempotency, visibility timeout
 *   - EventBus: subscribe, emit, wildcard, once, drain, dead letters
 *   - StateMachines: valid transitions, invalid transitions, terminal states
 *   - Entity stores: createInspection, createQuote, createJob, applyTransition
 *   - Workers: voice, image, report, quote, notify (all mock mode)
 *   - Coordinator: full saga (submit → voice → image → report → quote → approve → accept → job)
 *   - Server: HTTP integration for all major routes
 */

import { createServer }   from 'node:http';
import { randomUUID }     from 'node:crypto';

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0, failed = 0, skipped = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    process.stdout.write('.');
    passed++;
  } catch (err) {
    process.stdout.write('F');
    failed++;
    failures.push({ name, err });
  }
}

function assert(condition, msg = 'assertion failed') {
  if (!condition) throw new Error(msg);
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertThrows(fn, codePart) {
  try { fn(); throw new Error('expected throw but did not'); }
  catch (err) {
    if (codePart && !err.message.includes(codePart) && err.code !== codePart) {
      throw new Error(`Expected error containing '${codePart}', got: ${err.message}`);
    }
  }
}
async function assertRejects(fn, codePart) {
  try { await fn(); throw new Error('expected rejection but did not'); }
  catch (err) {
    if (codePart && !err.message.includes(codePart) && err.code !== codePart) {
      throw new Error(`Expected rejection containing '${codePart}', got: ${err.message}`);
    }
  }
}

// ─── Imports ──────────────────────────────────────────────────────────────────

import { Queue, queues }            from '../src/queue.js';
import { EventBus, EventTypes, bus } from '../src/events.js';
import {
  StateMachine, StateError,
  InspectionMachine, QuoteMachine, JobMachine,
  inspectionStore, quoteStore, jobStore,
  createInspection, createQuote, createJob,
} from '../src/state.js';

import { processVoiceJob }   from '../src/workers/voice.worker.js';
import { processImageJob }   from '../src/workers/image.worker.js';
import { processReportJob }  from '../src/workers/report.worker.js';
import { processQuoteJob }   from '../src/workers/quote.worker.js';
import { processNotifyJob }  from '../src/workers/notify.worker.js';

import {
  startCoordinator, stopCoordinator,
  submitInspection, approveQuote, acceptQuote, rejectQuote,
} from '../src/coordinator.js';

import { server } from '../src/server.js';

// Force mock mode for all workers
process.env.MOCK_WORKERS = 'true';

// ═══════════════════════════════════════════════════════════════════════════════
// QUEUE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── Queue ────────────────────────────────');

await test('enqueue returns a job with id and defaults', () => {
  const q = new Queue('test');
  const job = q.enqueue({ type: 'test.job', payload: { x: 1 } });
  assert(job.id, 'job has id');
  assertEqual(job.type, 'test.job');
  assertEqual(job.attempts, 0);
  assertEqual(job.priority, 5);
  assertEqual(job.errors.length, 0);
});

await test('dequeue returns null when empty', () => {
  const q = new Queue('test');
  assert(q.dequeue() === null);
});

await test('dequeue returns highest priority job first', () => {
  const q = new Queue('test');
  q.enqueue({ type: 'a', priority: 5 });
  q.enqueue({ type: 'b', priority: 1 });
  q.enqueue({ type: 'c', priority: 3 });
  const first = q.dequeue();
  assertEqual(first.type, 'b', 'priority 1 dequeued first');
});

await test('dequeue respects FIFO within same priority', async () => {
  const q = new Queue('test');
  const j1 = q.enqueue({ type: 'first', priority: 3 });
  await new Promise(r => setTimeout(r, 2));
  const j2 = q.enqueue({ type: 'second', priority: 3 });
  const got = q.dequeue();
  assertEqual(got.id, j1.id, 'older job dequeued first');
});

await test('dequeue respects next_attempt_at delay', async () => {
  const q = new Queue('test');
  q.enqueue({ type: 'delayed', delay_ms: 500 });
  assert(q.dequeue() === null, 'not ready yet');
});

await test('ack removes job from inflight', () => {
  const q = new Queue('test');
  q.enqueue({ type: 'x' });
  const job = q.dequeue();
  assert(q.hasInflight(job.id));
  q.ack(job.id);
  assert(!q.hasInflight(job.id));
});

await test('nack retries job with backoff', () => {
  const q = new Queue('test');
  q.enqueue({ type: 'x', max_attempts: 3 });
  const job = q.dequeue();  // attempts = 1
  const result = q.nack(job.id, 'fail');
  assertEqual(result, 'retry');
  assert(q.pendingCount() === 1);
  const retried = q.drain()[0];
  assertEqual(retried.attempts, 1);
  assert(retried.next_attempt_at > Date.now(), 'backoff applied');
});

await test('nack sends to DLQ after max attempts', () => {
  const q = new Queue('test');
  q.enqueue({ type: 'x', max_attempts: 1 });
  const job = q.dequeue();  // attempts = 1
  const result = q.nack(job.id, 'terminal fail');
  assertEqual(result, 'dlq');
  assertEqual(q.dlqCount(), 1);
  const dlqJob = q.listDlq()[0];
  assert(dlqJob.dead_lettered_at, 'has dead_lettered_at');
});

await test('idempotency key prevents duplicate enqueue', () => {
  const q = new Queue('test');
  const j1 = q.enqueue({ type: 'x', idempotency_key: 'my-key' });
  const j2 = q.enqueue({ type: 'x', idempotency_key: 'my-key' });
  assertEqual(j1.id, j2.id, 'same job returned');
  assertEqual(q.pendingCount(), 1);
});

await test('replayDlq re-enqueues with reset attempts', () => {
  const q = new Queue('test');
  q.enqueue({ type: 'x', max_attempts: 1 });
  const job = q.dequeue();
  q.nack(job.id, 'fail');
  assertEqual(q.dlqCount(), 1);
  q.replayDlq(job.id);
  assertEqual(q.dlqCount(), 0);
  assertEqual(q.pendingCount(), 1);
  const replayed = q.drain()[0];
  assertEqual(replayed.attempts, 0);
});

await test('stats returns correct counts', () => {
  const q = new Queue('stats-test');
  q.enqueue({ type: 'a' });
  q.enqueue({ type: 'b' });
  const j = q.dequeue();
  const s = q.stats();
  assertEqual(s.pending, 1);
  assertEqual(s.inflight, 1);
  assertEqual(s.dlq, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT BUS TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── EventBus ─────────────────────────────');

await test('emit delivers event to subscriber', async () => {
  const b = new EventBus();
  let received = null;
  b.on('test.event', e => { received = e; });
  b.emit('test.event', { val: 42 });
  await b.drain();
  assert(received !== null);
  assertEqual(received.payload.val, 42);
});

await test('wildcard subscriber receives all events', async () => {
  const b = new EventBus();
  const events = [];
  b.on('*', e => events.push(e));
  b.emit('event.a', { a: 1 });
  b.emit('event.b', { b: 2 });
  await b.drain();
  assertEqual(events.length, 2);
});

await test('once subscriber fires exactly once', async () => {
  const b = new EventBus();
  let count = 0;
  b.once('foo', () => count++);
  b.emit('foo');
  b.emit('foo');
  await b.drain();
  assertEqual(count, 1);
});

await test('off unsubscribes handler', async () => {
  const b = new EventBus();
  let count = 0;
  const unsub = b.on('bar', () => count++);
  b.emit('bar');
  await b.drain();
  unsub();
  b.emit('bar');
  await b.drain();
  assertEqual(count, 1, 'handler called only once');
});

await test('failed handler goes to dead letters after retries', async () => {
  const b = new EventBus();
  b.on('bad.event', async () => { throw new Error('handler exploded'); });
  b.emit('bad.event', {});
  await b.drain();
  assert(b.deadLetters().length >= 1, 'dead letter recorded');
});

await test('eventLog returns emitted events', async () => {
  const b = new EventBus();
  b.emit('log.test', { x: 1 });
  b.emit('log.test', { x: 2 });
  await b.drain();
  const log = b.eventLog(e => e.type === 'log.test');
  assertEqual(log.length, 2);
});

await test('event envelope has required fields', async () => {
  const b = new EventBus();
  let evt;
  b.on('env.test', e => { evt = e; });
  b.emit('env.test', { hello: 'world' }, { correlation_id: 'corr-123' });
  await b.drain();
  assert(evt.id, 'has id');
  assert(evt.type, 'has type');
  assert(evt.emitted_at, 'has emitted_at');
  assertEqual(evt.correlation_id, 'corr-123');
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── State Machines ───────────────────────');

await test('InspectionMachine: draft → submitted on submit', () => {
  const r = InspectionMachine.transition('draft', 'submit');
  assertEqual(r.state, 'submitted');
  assertEqual(r.previous, 'draft');
});

await test('InspectionMachine: submitted → processing on begin_processing', () => {
  const r = InspectionMachine.transition('submitted', 'begin_processing');
  assertEqual(r.state, 'processing');
});

await test('InspectionMachine: processing → complete on complete', () => {
  const r = InspectionMachine.transition('processing', 'complete');
  assertEqual(r.state, 'complete');
});

await test('InspectionMachine: processing → failed on fail', () => {
  const r = InspectionMachine.transition('processing', 'fail');
  assertEqual(r.state, 'failed');
});

await test('InspectionMachine: failed → submitted on retry', () => {
  const r = InspectionMachine.transition('failed', 'retry');
  assertEqual(r.state, 'submitted');
});

await test('InspectionMachine: throws on invalid event', () => {
  assertThrows(() => InspectionMachine.transition('draft', 'complete'), 'INVALID_TRANSITION');
});

await test('InspectionMachine: throws on terminal state', () => {
  assertThrows(() => InspectionMachine.transition('complete', 'submit'), 'TERMINAL_STATE');
});

await test('QuoteMachine: full happy path', () => {
  let s = 'draft';
  s = QuoteMachine.transition(s, 'generate').state;    // → generating
  s = QuoteMachine.transition(s, 'complete').state;    // → review
  s = QuoteMachine.transition(s, 'approve').state;     // → sent
  s = QuoteMachine.transition(s, 'customer_approve').state; // → accepted
  assertEqual(s, 'accepted');
});

await test('QuoteMachine: failure path → retry', () => {
  let s = 'generating';
  s = QuoteMachine.transition(s, 'fail').state;        // → failed
  s = QuoteMachine.transition(s, 'retry').state;       // → draft
  assertEqual(s, 'draft');
});

await test('JobMachine: pending → scheduled → in_progress → completed', () => {
  let s = 'pending';
  s = JobMachine.transition(s, 'schedule').state;
  s = JobMachine.transition(s, 'dispatch').state;
  s = JobMachine.transition(s, 'complete').state;
  assertEqual(s, 'completed');
});

await test('canTransition returns false for invalid event', () => {
  assert(!InspectionMachine.canTransition('complete', 'submit'));
  assert( InspectionMachine.canTransition('draft', 'submit'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENTITY STORE TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── Entity Stores ────────────────────────');

await test('createInspection creates entity in draft state', () => {
  const insp = createInspection({ company_id: 'co-1', technician_id: 'tech-1', address: '123 Main' });
  assertEqual(insp.state, 'draft');
  assert(insp.id, 'has id');
  assert(inspectionStore.has(insp.id));
});

await test('applyTransition advances inspection state', () => {
  const insp = createInspection({ company_id: 'co-2' });
  const updated = inspectionStore.applyTransition(insp.id, InspectionMachine, 'submit');
  assertEqual(updated.state, 'submitted');
  assertEqual(updated.state_history.length, 1);
  assertEqual(updated.state_history[0].event, 'submit');
});

await test('applyTransition throws NOT_FOUND for missing entity', () => {
  assertThrows(() => inspectionStore.applyTransition('no-such-id', InspectionMachine, 'submit'), 'NOT_FOUND');
});

await test('createQuote creates entity in draft state', () => {
  const q = createQuote({ company_id: 'co-1', customer_id: 'cust-1', inspection_id: 'insp-1' });
  assertEqual(q.state, 'draft');
  assert(quoteStore.has(q.id));
});

await test('createJob creates entity in pending state', () => {
  const j = createJob({ company_id: 'co-1', customer_id: 'cust-1' });
  assertEqual(j.state, 'pending');
  assert(jobStore.has(j.id));
});

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── Workers ──────────────────────────────');

await test('voice worker processes job and merges deficiencies', async () => {
  const b = new EventBus();
  stopCoordinator(); bus.reset(); startCoordinator();

  const insp = createInspection({ company_id: 'co-1' });
  const job = {
    id:             randomUUID(),
    payload:        { inspection_id: insp.id, recording_id: 'rec-1', transcript: 'Corroded sprinkler head on level 2.' },
    correlation_id: insp.id,
    attempts:       1,
  };

  const result = await processVoiceJob(job);
  assert(result.deficiencies, 'has deficiencies');
  assert(result.deficiencies.length > 0, 'at least one deficiency');

  const updated = inspectionStore.get(insp.id);
  assert(updated.deficiencies.length > 0, 'merged into inspection');
});

await test('image worker processes job and merges findings', async () => {
  const insp = createInspection({ company_id: 'co-1' });
  const job = {
    id:             randomUUID(),
    payload:        {
      inspection_id: insp.id,
      image_id:      'img-1',
      image:         { type: 'url', url: 'https://example.com/img.jpg', mediaType: 'image/jpeg' },
      context:       { location: 'Roof level' },
    },
    correlation_id: insp.id,
    attempts:       1,
  };

  const result = await processImageJob(job);
  assert(result.findings, 'has findings');
  assert(result.findings.length > 0, 'at least one finding');

  const updated = inspectionStore.get(insp.id);
  assert(updated.deficiencies.length > 0, 'merged into inspection');
});

await test('report worker builds and stores report', async () => {
  const insp = createInspection({ company_id: 'co-1' });
  // Add a deficiency directly
  inspectionStore.set(insp.id, {
    ...insp,
    report_id: 'rpt-1',
    deficiencies: [{
      id: 'def-1', type: 'corroded_head', severity: 'moderate',
      description: 'Corrosion on sprinkler head',
      nfpa_code: 'NFPA 25 5.2.1', location: 'Level 2', quantity: 1,
    }],
  });

  const job = {
    id:             randomUUID(),
    payload:        { inspection_id: insp.id, report_id: 'rpt-1' },
    correlation_id: insp.id,
    attempts:       1,
  };

  const report = await processReportJob(job);
  assertEqual(report.summary.total_deficiencies, 1);
  assertEqual(report.summary.moderate_count, 1);
  assertEqual(report.deficiencies[0].id, 'def-1');
});

await test('quote worker generates quote from deficiencies', async () => {
  const insp = createInspection({ company_id: 'co-1' });
  const wfQuote = createQuote({ company_id: 'co-1', customer_id: 'cust-1', inspection_id: insp.id });

  const job = {
    id:             randomUUID(),
    payload:        {
      inspection_id: insp.id,
      quote_id:      wfQuote.id,
      company_id:    'co-1',
      customer_id:   'cust-1',
      deficiencies:  [{ id: 'def-1', type: 'corroded_head', quantity: 2 }],
    },
    correlation_id: insp.id,
    attempts:       1,
  };

  const result = await processQuoteJob(job);
  assert(result.quote_id, 'engine quote id exists');
  assert(result.summary.total > 0, 'total is positive');

  const updated = quoteStore.get(wfQuote.id);
  assertEqual(updated.engine_quote_id, result.quote_id);
});

await test('notify worker sends email notification', async () => {
  const job = {
    id:             randomUUID(),
    payload:        {
      channel:    'email',
      recipient:  'admin@firesafe.com',
      template:   'quote.ready',
      data:       { quote_id: 'q-1', total: 1250.00 },
      metadata:   { quote_id: 'q-1' },
    },
    correlation_id: 'insp-1',
    attempts:       1,
  };

  const result = await processNotifyJob(job);
  assert(result.message_id, 'has message_id');
  assertEqual(result.provider, 'mock');
});

await test('notify worker throws on unknown channel', async () => {
  const job = {
    id:             randomUUID(),
    payload:        { channel: 'fax', recipient: '555-1234', template: 'test', data: {} },
    correlation_id: 'x',
    attempts:       1,
  };
  await assertRejects(() => processNotifyJob(job), 'Unknown notification channel');
});

// ═══════════════════════════════════════════════════════════════════════════════
// COORDINATOR / SAGA TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── Coordinator / Saga ───────────────────');

// Helper: manually run workers until all queues drain
async function drainAllQueues(maxTicks = 20) {
  const { processVoiceJob: pv }  = await import('../src/workers/voice.worker.js');
  const { processImageJob: pi }  = await import('../src/workers/image.worker.js');
  const { processReportJob: pr } = await import('../src/workers/report.worker.js');
  const { processQuoteJob: pq }  = await import('../src/workers/quote.worker.js');
  const { processNotifyJob: pn } = await import('../src/workers/notify.worker.js');

  for (let tick = 0; tick < maxTicks; tick++) {
    let worked = false;
    // Process one job per queue per tick
    for (const [qname, q, handler] of [
      ['voice',  queues.voice,  pv],
      ['image',  queues.image,  pi],
      ['report', queues.report, pr],
      ['quote',  queues.quote,  pq],
      ['notify', queues.notify, pn],
    ]) {
      const job = q.dequeue();
      if (job) {
        worked = true;
        try {
          await handler(job);
          q.ack(job.id);
        } catch (err) {
          q.nack(job.id, err.message);
        }
        await bus.drain();
      }
    }
    if (!worked) break;
  }
  await bus.drain();
}

await test('full saga: inspection → complete → quote generated', async () => {
  stopCoordinator(); bus.reset(); startCoordinator();

  // Create inspection with one recording and one image
  const insp = createInspection({ company_id: 'co-1', technician_id: 'tech-1' });
  inspectionStore.set(insp.id, {
    ...insp,
    voice_recordings: [{
      id: 'rec-1', transcript: 'Corroded sprinkler head on level 2.', context: {}, processed: false,
    }],
    images: [{
      id: 'img-1', image: { type: 'url', url: 'https://test.com/img.jpg' }, context: {}, processed: false,
    }],
  });

  // Submit
  submitInspection(insp.id);
  await bus.drain();

  // Should have enqueued voice + image jobs
  assert(queues.voice.pendingCount() > 0 || queues.voice.inflightCount() > 0 ||
         queues.image.pendingCount() > 0 || queues.image.inflightCount() > 0,
    'voice/image jobs enqueued');

  // Run all workers until done
  await drainAllQueues(30);

  const finalInspection = inspectionStore.get(insp.id);
  assertEqual(finalInspection.state, 'complete', `Expected complete, got ${finalInspection.state}`);

  // Quote should have been generated
  assert(finalInspection.quote_id, 'quote_id set on inspection');
  const wfQuote = quoteStore.get(finalInspection.quote_id);
  assert(wfQuote, 'quote entity exists');
  assert(['review', 'generating', 'draft'].includes(wfQuote.state), `quote state is ${wfQuote.state}`);
});

await test('approveQuote transitions quote to sent', async () => {
  stopCoordinator(); bus.reset(); startCoordinator();

  // Set up a quote in review state
  const insp = createInspection({ company_id: 'co-1' });
  const wfQuote = createQuote({ company_id: 'co-1', inspection_id: insp.id });
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'generate');
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'complete');
  assertEqual(quoteStore.get(wfQuote.id).state, 'review');

  approveQuote(wfQuote.id);
  await bus.drain();

  const updated = quoteStore.get(wfQuote.id);
  assertEqual(updated.state, 'sent');
});

await test('acceptQuote triggers job creation', async () => {
  stopCoordinator(); bus.reset(); startCoordinator();

  const insp = createInspection({ company_id: 'co-1' });
  const wfQuote = createQuote({ company_id: 'co-1', customer_id: 'cust-1', inspection_id: insp.id });

  // Manually fast-forward to sent state
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'generate');
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'complete');
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'approve');
  assertEqual(quoteStore.get(wfQuote.id).state, 'sent');

  acceptQuote(wfQuote.id);
  await bus.drain();

  assertEqual(quoteStore.get(wfQuote.id).state, 'accepted');
  const jobs = jobStore.values().filter(j => j.quote_id === wfQuote.id);
  assert(jobs.length > 0, 'job was created');
});

await test('rejectQuote transitions quote to rejected', async () => {
  const wfQuote = createQuote({ company_id: 'co-1', customer_id: 'cust-1', inspection_id: 'insp-x' });
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'generate');
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'complete');
  quoteStore.applyTransition(wfQuote.id, QuoteMachine, 'approve');

  rejectQuote(wfQuote.id, 'Too expensive');
  await bus.drain();
  assertEqual(quoteStore.get(wfQuote.id).state, 'rejected');
});

await test('failure event marks inspection as failed', async () => {
  stopCoordinator(); bus.reset(); startCoordinator();

  const insp = createInspection({ company_id: 'co-1' });
  inspectionStore.applyTransition(insp.id, InspectionMachine, 'submit');
  inspectionStore.applyTransition(insp.id, InspectionMachine, 'begin_processing');

  bus.emit(EventTypes.VOICE_FAILED, {
    inspection_id: insp.id,
    error: 'Service unavailable',
    dlq: true,
  }, { correlation_id: insp.id });
  await bus.drain();

  assertEqual(inspectionStore.get(insp.id).state, 'failed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER / HTTP INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── HTTP Server ──────────────────────────');

const BASE = 'http://localhost:3003';

async function http(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json();
  return { status: res.status, body: json };
}

await test('GET /health returns ok', async () => {
  const { status, body } = await http('GET', '/health');
  assertEqual(status, 200);
  assertEqual(body.status, 'ok');
  assert(body.queues, 'includes queue stats');
});

await test('POST /v1/inspection creates inspection', async () => {
  const { status, body } = await http('POST', '/v1/inspection', {
    company_id: 'co-http-1',
    technician_id: 'tech-http-1',
    address: '456 Oak Ave',
  });
  assertEqual(status, 201);
  assert(body.success);
  assert(body.data.id);
  assertEqual(body.data.state, 'draft');
  assertEqual(body.data.company_id, 'co-http-1');
});

await test('POST /v1/inspection returns 400 if missing company_id', async () => {
  const { status, body } = await http('POST', '/v1/inspection', { address: '123' });
  assertEqual(status, 400);
  assert(!body.success);
});

await test('GET /v1/inspection/:id retrieves inspection', async () => {
  const { body: created } = await http('POST', '/v1/inspection', { company_id: 'co-http-2' });
  const id = created.data.id;
  const { status, body } = await http('GET', `/v1/inspection/${id}`);
  assertEqual(status, 200);
  assertEqual(body.data.id, id);
});

await test('GET /v1/inspection/:id returns 404 for missing', async () => {
  const { status } = await http('GET', '/v1/inspection/does-not-exist');
  assertEqual(status, 404);
});

await test('POST /v1/inspection/:id/recording adds recording', async () => {
  const { body: created } = await http('POST', '/v1/inspection', { company_id: 'co-http-3' });
  const id = created.data.id;
  const { status, body } = await http('POST', `/v1/inspection/${id}/recording`, {
    transcript: 'Three corroded sprinkler heads on the third floor east wing.',
  });
  assertEqual(status, 201);
  assert(body.data.recording_id);
});

await test('POST /v1/inspection/:id/recording validates transcript length', async () => {
  const { body: created } = await http('POST', '/v1/inspection', { company_id: 'co-http-4' });
  const { status } = await http('POST', `/v1/inspection/${created.data.id}/recording`, {
    transcript: 'short',
  });
  assertEqual(status, 400);
});

await test('POST /v1/inspection/:id/image adds image', async () => {
  const { body: created } = await http('POST', '/v1/inspection', { company_id: 'co-http-5' });
  const id = created.data.id;
  const { status, body } = await http('POST', `/v1/inspection/${id}/image`, {
    image: { type: 'url', url: 'https://example.com/img.jpg' },
    context: { location: 'Roof' },
  });
  assertEqual(status, 201);
  assert(body.data.image_id);
});

await test('POST /v1/inspection/:id/submit returns 404 for missing', async () => {
  const { status } = await http('POST', '/v1/inspection/no-such/submit');
  assertEqual(status, 404);
});

await test('POST /v1/inspection/:id/submit transitions to submitted/processing', async () => {
  const { body: created } = await http('POST', '/v1/inspection', { company_id: 'co-http-6' });
  const id = created.data.id;
  // Add a recording
  await http('POST', `/v1/inspection/${id}/recording`, {
    transcript: 'Fire extinguisher pressure gauge in red zone, needs replacement.',
  });
  const { status, body } = await http('POST', `/v1/inspection/${id}/submit`);
  assertEqual(status, 200);
  assert(['submitted', 'processing'].includes(body.data.state),
    `Expected submitted/processing, got ${body.data.state}`);
});

await test('GET /v1/queue/stats returns stats for all queues', async () => {
  const { status, body } = await http('GET', '/v1/queue/stats');
  assertEqual(status, 200);
  assert(body.data.voice, 'has voice queue stats');
  assert(body.data.image, 'has image queue stats');
  assert(body.data.notify, 'has notify queue stats');
});

await test('GET /v1/queue/dlq returns dlq contents', async () => {
  const { status, body } = await http('GET', '/v1/queue/dlq');
  assertEqual(status, 200);
  assert(typeof body.data === 'object');
});

await test('GET /v1/job/:id returns 404 for missing', async () => {
  const { status } = await http('GET', '/v1/job/no-such-job');
  assertEqual(status, 404);
});

await test('GET /v1/quote/:id returns 404 for missing', async () => {
  const { status } = await http('GET', '/v1/quote/no-such-quote');
  assertEqual(status, 404);
});

await test('POST /v1/quote/:id/approve returns 404 for missing', async () => {
  const { status } = await http('POST', '/v1/quote/no-such/approve');
  assertEqual(status, 404);
});

await test('unknown route returns 404', async () => {
  const { status } = await http('GET', '/v1/unknown');
  assertEqual(status, 404);
});

// ─── Shutdown & results ────────────────────────────────────────────────────────

server.close();
stopCoordinator();

console.log('\n');
console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const { name, err } of failures) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    if (err.stack) console.log(err.stack.split('\n').slice(1, 3).map(l => `    ${l}`).join('\n'));
  }
}

process.exit(failed > 0 ? 1 : 0);
