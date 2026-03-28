/**
 * report.worker.js — Generates inspection report from processed deficiencies
 *
 * Job payload:
 *   {
 *     inspection_id: string
 *     report_id:     string     — pre-assigned report ID
 *   }
 *
 * The report is a structured summary of all deficiencies found during the
 * inspection, aggregated from both voice and image sources.
 *
 * On success:  emits REPORT_GENERATED, stores report in inspection
 * On failure:  nack → retry, or DLQ → emits REPORT_FAILED
 */

import { queues }            from '../queue.js';
import { bus, EventTypes }   from '../events.js';
import { inspectionStore }   from '../state.js';

let _running  = false;
let _interval = null;
const POLL_MS = parseInt(process.env.WORKER_POLL_MS ?? '500', 10);

// ─── Report builder ───────────────────────────────────────────────────────────

function buildReport(inspection) {
  const defs = inspection.deficiencies ?? [];

  // Group deficiencies by severity
  const bySeverity = { critical: [], moderate: [], minor: [], unknown: [] };
  for (const def of defs) {
    const bucket = bySeverity[def.severity] ?? bySeverity.unknown;
    bucket.push(def);
  }

  // NFPA category breakdown
  const nfpaCodes = [...new Set(defs.map(d => d.nfpa_code).filter(Boolean))];

  // Source breakdown
  const voiceCount = defs.filter(d => d.source !== 'image').length;
  const imageCount = defs.filter(d => d.source === 'image').length;

  return {
    report_id:       inspection.report_id,
    inspection_id:   inspection.id,
    company_id:      inspection.company_id,
    technician_id:   inspection.technician_id,
    address:         inspection.address,
    inspection_type: inspection.inspection_type,
    generated_at:    new Date().toISOString(),
    summary: {
      total_deficiencies:    defs.length,
      critical_count:        bySeverity.critical.length,
      moderate_count:        bySeverity.moderate.length,
      minor_count:           bySeverity.minor.length,
      voice_detected_count:  voiceCount,
      image_detected_count:  imageCount,
      nfpa_codes_referenced: nfpaCodes,
    },
    deficiencies: defs.map(d => ({
      id:          d.id,
      type:        d.type,
      severity:    d.severity,
      description: d.description,
      nfpa_code:   d.nfpa_code,
      location:    d.location,
      quantity:    d.quantity ?? 1,
      source:      d.source ?? 'voice',
      confidence:  d.confidence ?? null,
    })),
    notes:    inspection.notes ?? '',
    status:   'final',
  };
}

// ─── Process one job ──────────────────────────────────────────────────────────

export async function processReportJob(job) {
  const { inspection_id } = job.payload;

  bus.emit(EventTypes.REPORT_GENERATING, { inspection_id, job_id: job.id },
    { correlation_id: job.correlation_id });

  const inspection = inspectionStore.get(inspection_id);
  if (!inspection) throw new Error(`Inspection ${inspection_id} not found`);

  // Small delay simulating async report generation (PDF rendering, etc.)
  await new Promise(r => setTimeout(r, 5));

  const report = buildReport(inspection);

  // Store report on the inspection entity
  inspectionStore.set(inspection_id, {
    ...inspection,
    report,
    report_id:  report.report_id,
    updated_at: new Date().toISOString(),
  });

  bus.emit(EventTypes.REPORT_GENERATED, {
    inspection_id,
    report_id:  report.report_id,
    job_id:     job.id,
    def_count:  report.summary.total_deficiencies,
  }, { correlation_id: job.correlation_id });

  return report;
}

// ─── Worker loop ──────────────────────────────────────────────────────────────

export function startReportWorker() {
  if (_running) return;
  _running = true;

  _interval = setInterval(async () => {
    const job = queues.report.dequeue();
    if (!job) return;

    try {
      await processReportJob(job);
      queues.report.ack(job.id);
    } catch (err) {
      const result = queues.report.nack(job.id, err.message);
      if (result === 'dlq') {
        bus.emit(EventTypes.REPORT_FAILED, {
          inspection_id: job.payload.inspection_id,
          job_id:        job.id,
          error:         err.message,
          dlq:           true,
        }, { correlation_id: job.correlation_id });
      }
    }
  }, POLL_MS);

  _interval.unref?.();
}

export function stopReportWorker() {
  _running = false;
  if (_interval) { clearInterval(_interval); _interval = null; }
}
