/**
 * pricing-config.js — Base Pricing Framework for FireFlow
 *
 * Stores per-company pricing settings in localStorage and provides
 * auto-calculation of line item prices from deficiency types.
 *
 * Price formula per line item:
 *   base     = (laborHours * laborRate) + (materials * (1 + markupPct/100))
 *   final    = max(minServiceFee, base)
 *   if emergency: final *= emergencyMultiplier
 */

// ── Industry defaults (CAD, fire suppression averages) ────────────────────────

export const DEFAULT_PRICING = {
  laborRate:             95,    // CAD $/hour
  materialMarkupPercent: 20,    // %
  minServiceFee:         50,    // CAD $
  callOutFee:            100,   // CAD $ flat per site visit
  emergencyMultiplier:   1.5,   // x multiplier for after-hours / urgent
  currency:              'CAD',
};

const STORAGE_KEY = 'ff_pricing';

// ── Persistence ───────────────────────────────────────────────────────────────

export function loadPricing() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PRICING, ...JSON.parse(raw) } : { ...DEFAULT_PRICING };
  } catch {
    return { ...DEFAULT_PRICING };
  }
}

export function savePricing(updates) {
  const current = loadPricing();
  const next    = { ...current, ...updates };
  const user    = (() => { try { return JSON.parse(localStorage.getItem('ff_user') ?? '{}'); } catch { return {}; } })();
  // Audit trail — last 20 entries
  const audit   = loadPricingAudit();
  audit.unshift({ changedAt: new Date().toISOString(), changedBy: user.email ?? 'admin', diff: updates });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  localStorage.setItem(STORAGE_KEY + '_audit', JSON.stringify(audit.slice(0, 20)));
  return next;
}

export function loadPricingAudit() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY + '_audit') ?? '[]'); } catch { return []; }
}

// ── Deficiency → labor hours + base materials map ─────────────────────────────
// Values represent real fire suppression field estimates.

export const DEFICIENCY_LABOR_MAP = {
  // Sprinkler
  'Sprinkler Head Obstruction':    { hours: 0.5,  materials: 0   },
  'Missing Sprinkler Head':        { hours: 1.5,  materials: 45  },
  'Corroded Sprinkler Head':       { hours: 1.0,  materials: 35  },
  'Painted Sprinkler Head':        { hours: 1.0,  materials: 35  },
  'Insufficient Clearance':        { hours: 0.5,  materials: 0   },
  'Main Valve Issue':              { hours: 2.5,  materials: 120 },
  'Pressure Out of Range':         { hours: 1.5,  materials: 30  },
  'Missing Spare Heads/Wrench':    { hours: 0.5,  materials: 75  },
  'FDC Obstruction':               { hours: 0.75, materials: 0   },

  // Standpipe
  'PRV Out of Adjustment':         { hours: 2.0,  materials: 50  },
  'Pressure Failure':              { hours: 2.5,  materials: 70  },
  'Hose Valve Inaccessible':       { hours: 1.0,  materials: 0   },
  'Missing FDC Caps':              { hours: 0.5,  materials: 30  },
  'Cabinet Obstructed':            { hours: 0.5,  materials: 0   },

  // Fire Alarm
  'Trouble Signal Active':         { hours: 1.5,  materials: 25  },
  'Device Failure':                { hours: 2.0,  materials: 180 },
  'Battery Failure':               { hours: 1.0,  materials: 90  },
  'Pull Station Obstructed':       { hours: 0.5,  materials: 0   },
  'Audibility Failure':            { hours: 2.0,  materials: 60  },
  'Monitoring Issue':              { hours: 1.0,  materials: 0   },

  // Kitchen Hood
  'Agent Cylinder Low/Empty':      { hours: 2.0,  materials: 220 },
  'Nozzle Obstruction':            { hours: 1.0,  materials: 0   },
  'Mechanical Link Expired':       { hours: 1.5,  materials: 45  },
  'Fuel Shut-off Failure':         { hours: 2.5,  materials: 80  },
  'Pull Station Inaccessible':     { hours: 0.75, materials: 0   },
  'Hood/Duct Not Cleaned':         { hours: 4.0,  materials: 50  },

  // Backflow
  'Check Valve Failure':           { hours: 3.0,  materials: 200 },
  'Relief Valve Failure':          { hours: 2.0,  materials: 120 },
  'Valve Not Supervised':          { hours: 1.0,  materials: 30  },

  // General
  'No Inspection Tag':             { hours: 0.25, materials: 8   },
  'Unauthorized Modification':     { hours: 3.0,  materials: 120 },
  'Missing Documentation':         { hours: 0.5,  materials: 12  },
  'Room Access Issue':             { hours: 0.5,  materials: 0   },
  'Storage Obstruction':           { hours: 0.5,  materials: 0   },
  'General Note':                  { hours: 1.0,  materials: 0   },

  // Fallback for unknown types
  '_default':                      { hours: 1.0,  materials: 0   },
};

// ── Core calculation ──────────────────────────────────────────────────────────

/**
 * Calculate the price for a single deficiency line item.
 * @param {string}  defType     - Deficiency type string from DEFICIENCY_TYPES
 * @param {object}  pricing     - Result of loadPricing()
 * @param {boolean} isEmergency - Apply emergency multiplier
 * @returns {number} Rounded price in dollars
 */
export function calculateLineItemPrice(defType, pricing, isEmergency = false) {
  const p         = pricing ?? loadPricing();
  const labor     = DEFICIENCY_LABOR_MAP[defType] ?? DEFICIENCY_LABOR_MAP['_default'];
  const laborCost = labor.hours * p.laborRate;
  const matCost   = labor.materials * (1 + p.materialMarkupPercent / 100);
  let   price     = Math.max(p.minServiceFee, laborCost + matCost);
  if (isEmergency) price = price * p.emergencyMultiplier;
  return Math.round(price * 100) / 100;
}

/**
 * Build a call-out fee line item using current pricing settings.
 * @param {object} pricing - Result of loadPricing()
 * @returns {object} Line item object
 */
export function buildCallOutLineItem(pricing) {
  const p = pricing ?? loadPricing();
  return {
    id:          'li_callout_' + Date.now(),
    description: 'Site Visit / Call-Out Fee',
    qty:         1,
    unitPrice:   p.callOutFee,
    category:    'labor',
    locked:      true,
    _autoPriced: true,
  };
}

/**
 * Validate pricing config values — returns array of error strings (empty = valid).
 */
export function validatePricing(values) {
  const errors = [];
  if (!values.laborRate || values.laborRate <= 0)             errors.push('Labor rate must be greater than 0');
  if (values.materialMarkupPercent < 0)                       errors.push('Material markup cannot be negative');
  if (!values.minServiceFee || values.minServiceFee <= 0)     errors.push('Minimum service fee must be greater than 0');
  if (!values.callOutFee || values.callOutFee < 0)            errors.push('Call-out fee cannot be negative');
  if (!values.emergencyMultiplier || values.emergencyMultiplier < 1) errors.push('Emergency multiplier must be 1.0 or greater');
  return errors;
}
