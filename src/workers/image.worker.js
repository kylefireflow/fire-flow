/**
 * image.worker.js — Worker that processes image analysis jobs
 *
 * Pulls jobs from queues.image, calls the image-analyzer service,
 * writes findings back to the inspection, emits events.
 *
 * Job payload:
 *   {
 *     inspection_id: string
 *     image_id:      string     — ID of the images[] entry
 *     image:         object     — { type: 'base64'|'url', data, mediaType, url }
 *     context:       object     — optional (system_type, location, etc.)
 *   }
 *
 * On success:  emits IMAGE_PROCESSED, merges findings into inspection.deficiencies
 * On failure:  nack → retry (with backoff), or DLQ → emits IMAGE_FAILED
 */

import { queues }            from '../queue.js';
import { bus, EventTypes }   from '../events.js';
import { inspectionStore }   from '../state.js';

const IMAGE_SERVICE_URL = process.env.IMAGE_SERVICE_URL ?? 'http://localhost:3001';
// MOCK_WORKERS checked at runtime via process.env

let _running  = false;
let _interval = null;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? '500', 10);

// ─── Mock response ────────────────────────────────────────────────────────────

function mockAnalysisResult(context = {}) {
  return {
    image_quality:       'fair',
    system_type:         context.system_type ?? 'wet_pipe_sprinkler',
    component_identified: 'sprinkler head',
    no_deficiency_found:  false,
    analyst_notes:        'Mock analysis result',
    findings: [
      {
        issue:           'corroded_sprinkler_head',
        confidence:      0.87,
        confidence_label: 'high',
        severity:         'moderate',
        description:      'Visible corrosion on sprinkler head deflector and frame.',
        nfpa_code:        'NFPA 25 5.2.1',
        nfpa_category:    'Sprinkler',
      },
    ],
  };
}

// ─── Convert image finding to deficiency format ───────────────────────────────

function findingToDeficiency(finding, imageId, location) {
  return {
    id:          `img-${imageId}-${finding.issue}`,
    type:        finding.issue,
    severity:    finding.severity,
    description: finding.description,
    nfpa_code:   finding.nfpa_code,
    location:    location ?? '',
    quantity:    1,
    source:      'image',
    confidence:  finding.confidence,
    image_id:    imageId,
  };
}

// ─── Process one job ──────────────────────────────────────────────────────────

export async function processImageJob(job) {
  const { inspection_id, image_id, image, context = {} } = job.payload;

  bus.emit(EventTypes.IMAGE_PROCESSING, { inspection_id, image_id, job_id: job.id },
    { correlation_id: job.correlation_id });

  let result;
  if (process.env.MOCK_WORKERS === 'true') {
    await new Promise(r => setTimeout(r, 10));
    result = mockAnalysisResult(context);
  } else {
    const response = await fetch(`${IMAGE_SERVICE_URL}/v1/analyze`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image, context }),
      signal:  AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw Object.assign(new Error(`Image service error ${response.status}: ${text}`), {
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    const json = await response.json();
    if (!json.success) throw new Error(`Image analysis failed: ${json.error?.message}`);
    result = json.data;
  }

  // Merge findings into inspection
  const inspection = inspectionStore.get(inspection_id);
  if (inspection) {
    const existing = new Map((inspection.deficiencies ?? []).map(d => [d.id, d]));

    const location = context.location ?? '';
    for (const finding of result.findings ?? []) {
      const def = findingToDeficiency(finding, image_id, location);
      existing.set(def.id, def);
    }

    // Mark image as processed
    const images = (inspection.images ?? []).map(img =>
      img.id === image_id ? { ...img, processed: true, result } : img
    );

    inspectionStore.set(inspection_id, {
      ...inspection,
      deficiencies: [...existing.values()],
      images,
      updated_at:   new Date().toISOString(),
    });
  }

  bus.emit(EventTypes.IMAGE_PROCESSED, {
    inspection_id,
    image_id,
    job_id:         job.id,
    finding_count:  result.findings?.length ?? 0,
    result,
  }, { correlation_id: job.correlation_id });

  return result;
}

// ─── Worker loop ──────────────────────────────────────────────────────────────

export function startImageWorker() {
  if (_running) return;
  _running = true;

  _interval = setInterval(async () => {
    const job = queues.image.dequeue();
    if (!job) return;

    try {
      await processImageJob(job);
      queues.image.ack(job.id);
    } catch (err) {
      const result = queues.image.nack(job.id, err.message);
      if (result === 'dlq') {
        bus.emit(EventTypes.IMAGE_FAILED, {
          inspection_id: job.payload.inspection_id,
          image_id:      job.payload.image_id,
          job_id:        job.id,
          error:         err.message,
          dlq:           true,
        }, { correlation_id: job.correlation_id });
      }
    }
  }, POLL_MS);

  _interval.unref?.();
}

export function stopImageWorker() {
  _running = false;
  if (_interval) { clearInterval(_interval); _interval = null; }
}
