/**
 * state.js — State machines for Inspection, Quote, and Job entities
 *
 * Each state machine defines:
 *   - states:      valid state strings
 *   - transitions: { [fromState]: { [eventName]: toState } }
 *   - guards:      optional condition functions blocking a transition
 *   - onEnter:     optional side-effect called when entering a state
 *
 * Usage:
 *   const machine = InspectionMachine;
 *   const next = machine.transition(currentState, event, context);
 *   // next: { state, changed } — or throws StateError if invalid
 *
 * ─── Inspection state diagram ────────────────────────────────────────────────
 *
 *  DRAFT ──submit──► SUBMITTED ──begin_processing──► PROCESSING
 *    │                                                    │
 *    │                                            ┌───────┴───────┐
 *    │                                         complete         fail
 *    │                                            │               │
 *    └──cancel──► CANCELLED          COMPLETE ◄──┘         FAILED ──retry──► SUBMITTED
 *
 * ─── Quote state diagram ─────────────────────────────────────────────────────
 *
 *  DRAFT ──generate──► GENERATING ──complete──► REVIEW
 *    │                      │                     │
 *    │                    fail                  approve ──► SENT ──customer_approve──► ACCEPTED
 *    │                      │                     │                └──customer_reject──► REJECTED
 *    │                   FAILED──retry──► DRAFT   │
 *    │                                          reject──► REJECTED
 *    └──cancel──► CANCELLED
 *
 * ─── Job state diagram ───────────────────────────────────────────────────────
 *
 *  PENDING ──schedule──► SCHEDULED ──dispatch──► IN_PROGRESS
 *                │                                    │
 *            cancel                           ┌───────┴──────┐
 *                │                         complete        fail
 *                ▼                            │               │
 *          CANCELLED                      COMPLETED       FAILED──retry──► SCHEDULED
 */

// ─── StateError ───────────────────────────────────────────────────────────────

export class StateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StateError';
    this.code = code;
  }
}

// ─── StateMachine ─────────────────────────────────────────────────────────────

export class StateMachine {
  #name;
  #transitions;
  #terminal;

  /**
   * @param {string} name
   * @param {object} transitions  { fromState: { event: toState } }
   * @param {string[]} terminal   States from which no transitions are allowed
   */
  constructor(name, transitions, terminal = []) {
    this.#name        = name;
    this.#transitions = transitions;
    this.#terminal    = new Set(terminal);
  }

  get name() { return this.#name; }

  /**
   * Return all valid states.
   */
  get states() {
    const s = new Set();
    for (const [from, events] of Object.entries(this.#transitions)) {
      s.add(from);
      for (const to of Object.values(events)) s.add(to);
    }
    return [...s];
  }

  /**
   * Apply an event to a current state and return the new state.
   *
   * @param {string}  currentState
   * @param {string}  event
   * @param {object}  [context]    Optional contextual data for guard evaluation
   * @returns {{ state: string, changed: boolean, previous: string }}
   * @throws {StateError} INVALID_STATE | INVALID_TRANSITION | TERMINAL_STATE
   */
  transition(currentState, event, context = {}) {
    // Terminal check first — terminal states are defined in transitions as empty objects
    if (this.#terminal.has(currentState)) {
      throw new StateError('TERMINAL_STATE',
        `${this.#name}: state '${currentState}' is terminal — no transitions allowed`);
    }
    if (!this.#transitions[currentState]) {
      throw new StateError('INVALID_STATE',
        `${this.#name}: unknown state '${currentState}'`);
    }

    const toState = this.#transitions[currentState][event];
    if (!toState) {
      const valid = Object.keys(this.#transitions[currentState]);
      throw new StateError('INVALID_TRANSITION',
        `${this.#name}: event '${event}' is not valid in state '${currentState}'. ` +
        `Valid events: ${valid.join(', ')}`);
    }

    return { state: toState, changed: toState !== currentState, previous: currentState };
  }

  /**
   * Check if a transition is valid without throwing.
   */
  canTransition(currentState, event) {
    try { this.transition(currentState, event); return true; }
    catch (_) { return false; }
  }

  /**
   * Return the valid events from a given state.
   */
  validEvents(currentState) {
    return Object.keys(this.#transitions[currentState] ?? {});
  }

  isTerminal(state) {
    return this.#terminal.has(state);
  }
}

// ─── Inspection Machine ───────────────────────────────────────────────────────

export const InspectionMachine = new StateMachine('Inspection', {
  draft: {
    submit:             'submitted',
    cancel:             'cancelled',
  },
  submitted: {
    begin_processing:   'processing',
    cancel:             'cancelled',
  },
  processing: {
    complete:           'complete',
    fail:               'failed',
  },
  failed: {
    retry:              'submitted',
    cancel:             'cancelled',
  },
  // Terminal states below (defined but no outbound events)
  complete:   {},
  cancelled:  {},
}, ['complete', 'cancelled']);

// ─── Quote Machine ────────────────────────────────────────────────────────────

export const QuoteMachine = new StateMachine('Quote', {
  draft: {
    generate:            'generating',
    cancel:              'cancelled',
  },
  generating: {
    complete:            'review',
    fail:                'failed',
  },
  review: {
    approve:             'sent',
    reject:              'rejected',
    edit:                'draft',           // Admin sends back for regen
  },
  sent: {
    customer_approve:    'accepted',
    customer_reject:     'rejected',
    expire:              'expired',
  },
  failed: {
    retry:               'draft',
    cancel:              'cancelled',
  },
  // Terminal
  accepted:   {},
  rejected:   {},
  expired:    {},
  cancelled:  {},
}, ['accepted', 'rejected', 'expired', 'cancelled']);

// ─── Job Machine ──────────────────────────────────────────────────────────────

export const JobMachine = new StateMachine('Job', {
  pending: {
    schedule:            'scheduled',
    cancel:              'cancelled',
  },
  scheduled: {
    dispatch:            'in_progress',
    reschedule:          'scheduled',
    cancel:              'cancelled',
  },
  in_progress: {
    complete:            'completed',
    fail:                'failed',
    pause:               'scheduled',   // Reschedule if blocked on parts
  },
  failed: {
    retry:               'scheduled',
    cancel:              'cancelled',
  },
  // Terminal
  completed:  {},
  cancelled:  {},
}, ['completed', 'cancelled']);

// ─── Entity store (in-memory with write-through DB persistence) ──────────────

import { persistEntity, loadStore } from './persistence.js';

class EntityStore {
  #store = new Map();
  #name;
  #table;

  constructor(name, table) {
    this.#name  = name;
    this.#table = table;
  }

  get(id)   { return this.#store.get(id) ?? null; }

  set(id, entity) {
    this.#store.set(id, entity);
    // Write-through: persist to DB in the background (fire-and-forget)
    persistEntity(this.#table, entity);
    return entity;
  }

  has(id)    { return this.#store.has(id); }
  delete(id) { return this.#store.delete(id); }
  values()   { return [...this.#store.values()]; }
  count()    { return this.#store.size; }

  /** Expose the internal Map so persistence.js can bootstrap it */
  get _map() { return this.#store; }

  /** Load all rows from DB into memory. Called once at server startup. */
  async loadFromDb() {
    return loadStore(this.#table, this.#store);
  }

  /** Apply a state transition and persist the updated entity */
  applyTransition(id, machine, event, extraFields = {}) {
    const entity = this.get(id);
    if (!entity) throw new StateError('NOT_FOUND', `${this.#name} ${id} not found`);

    const result = machine.transition(entity.state, event);
    const updated = {
      ...entity,
      ...extraFields,
      state:       result.state,
      previous_state: result.previous,
      updated_at:  new Date().toISOString(),
      state_history: [
        ...(entity.state_history ?? []),
        { from: result.previous, to: result.state, event, at: new Date().toISOString() },
      ],
    };

    this.set(id, updated);
    return updated;
  }
}

export const inspectionStore = new EntityStore('Inspection', 'inspections');
export const quoteStore      = new EntityStore('Quote',      'quotes');
export const jobStore        = new EntityStore('Job',        'jobs');
export const companyStore    = new EntityStore('Company',    'companies');

// ─── Factory helpers ──────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';

/**
 * Create a new inspection entity in DRAFT state.
 */
export function createInspection({ company_id, technician_id, technician_email = null, admin_email = null, customer_email = null, address, inspection_type = 'routine', notes = '' } = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const entity = {
    id,
    state:            'draft',
    previous_state:   null,
    company_id,
    technician_id,
    technician_email,
    admin_email,
    customer_email,
    address,
    inspection_type,
    notes,
    voice_recordings: [],
    images:           [],
    deficiencies:     [],
    report_id:        null,
    quote_id:         null,
    created_at:       now,
    updated_at:       now,
    state_history:    [],
  };
  inspectionStore.set(id, entity);
  return entity;
}

/**
 * Create a new quote entity in DRAFT state, linked to an inspection.
 */
export function createQuote({ company_id, customer_id, inspection_id, customer_email = null } = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const entity = {
    id,
    state:          'draft',
    previous_state: null,
    company_id,
    customer_id,
    inspection_id,
    customer_email,
    line_items:     [],
    summary:        null,
    engine_quote_id: null,    // ID from quote-engine service
    created_at:     now,
    updated_at:     now,
    state_history:  [],
  };
  quoteStore.set(id, entity);
  return entity;
}

/**
 * Create a new job entity in PENDING state, linked to an approved quote.
 */
export function createJob({ company_id, customer_id, inspection_id, quote_id, scheduled_date = null, technician_id = null, technician_email = null } = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const entity = {
    id,
    state:          'pending',
    previous_state: null,
    company_id,
    customer_id,
    inspection_id,
    quote_id,
    scheduled_date,
    technician_id,
    technician_email,
    created_at:     now,
    updated_at:     now,
    state_history:  [],
  };
  jobStore.set(id, entity);
  return entity;
}
