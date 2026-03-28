/**
 * voice.worker.js — Worker that processes voice recording jobs
 *
 * Pulls jobs from queues.voice, calls the voice-parser service,
 * writes result back to the inspection, emits events.
 *
 * Job payload:
 *   {
 *     inspection_id: string
 *     recording_id:  string      — ID of the voice_recording entry
 *     transcript:    string      — raw transcript text
 *     context:       object      — optional parser context hints
 *   }
 *
 * On success:  emits VOICE_PROCESSED, updates inspection.deficiencies
 * On failure:  nack → retry (with backoff), or DLQ → emits VOICE_FAILED
 */

import { queues }            from '../queue.js';
import { bus, EventTypes }   from '../events.js';
import { inspectionStore }   from '../state.js';

const VOICE_SERVICE_URL = process.env.VOICE_SERVICE_URL ?? 'http://localhost:3000';
// MOCK_WORKERS checked at runtime via process.env

let _running = false;
let _interval = null;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? '500', 10);

// ─── Mock response ────────────────────────────────────────────────────────────

function mockParseResult(transcript) {
  return {
    deficiencies: [
      {
        id:          'mock-def-001',
        type:        'corroded_sprinkler_head',
        severity:    'moderate',
        description: `Mocked parse of: "${transcript.slice(0, 60)}"`,
        nfpa_code:   'NFPA 25 5.2.1',
        location:    'Level 2 — east corridor',
        quantity:    2,
      },
    ],
    system_type: 'wet_pipe_sprinkler',
    raw_transcript: transcript,
  };
}

// ─── Process one job ──────────────────────────────────────────────────────────

export async function processVoiceJob(job) {
  const { inspection_id, recording_id, transcript, context = {} } = job.payload;

  bus.emit(EventTypes.VOICE_PROCESSING, { inspection_id, recording_id, job_id: job.id },
    { correlation_id: job.correlation_id });

  let result;
  if (process.env.MOCK_WORKERS === 'true') {
    // Simulate processing delay
    await new Promise(r => setTimeout(r, 10));
    result = mockParseResult(transcript);
  } else {
    // Call the voice-parser service
    const response = await fetch(`${VOICE_SERVICE_URL}/v1/parse`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ transcript, context }),
      signal:  AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Voice service error ${response.status}: ${text}`), {
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    const json = await response.json();
    if (!json.success) throw new Error(`Voice parse failed: ${json.error?.message}`);
    result = json.data;
  }

  // Merge deficiencies into inspection
  const inspection = inspectionStore.get(inspection_id);
  if (inspection) {
    const existing = new Map((inspection.deficiencies ?? []).map(d => [d.id, d]));
    for (const def of result.deficiencies ?? []) existing.set(def.id, def);

    // Mark recording as processed
    const recordings = (inspection.voice_recordings ?? []).map(r =>
      r.id === recording_id ? { ...r, processed: true, result } : r
    );

    inspectionStore.set(inspection_id, {
      ...inspection,
      deficiencies:     [...existing.values()],
      voice_recordings: recordings,
      updated_at:       new Date().toISOString(),
    });
  }

  bus.emit(EventTypes.VOICE_PROCESSED, {
    inspection_id,
    recording_id,
    job_id:           job.id,
    deficiency_count: result.deficiencies?.length ?? 0,
    result,
  }, { correlation_id: job.correlation_id });

  return result;
}

// ─── Worker loop ──────────────────────────────────────────────────────────────

export function startVoiceWorker() {
  if (_running) return;
  _running = true;

  _interval = setInterval(async () => {
    const job = queues.voice.dequeue();
    if (!job) return;

    try {
      await processVoiceJob(job);
      queues.voice.ack(job.id);
    } catch (err) {
      const result = queues.voice.nack(job.id, err.message);
      if (result === 'dlq') {
        bus.emit(EventTypes.VOICE_FAILED, {
          inspection_id: job.payload.inspection_id,
          recording_id:  job.payload.recording_id,
          job_id:        job.id,
          error:         err.message,
          dlq:           true,
        }, { correlation_id: job.correlation_id });
      }
    }
  }, POLL_MS);

  _interval.unref?.();
}

export function stopVoiceWorker() {
  _running = false;
  if (_interval) { clearInterval(_interval); _interval = null; }
}
