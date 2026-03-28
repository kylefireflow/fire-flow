/**
 * scripts/create-user.js — Create the first admin or technician user
 *
 * Usage:
 *   node scripts/create-user.js
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from .env (or environment).
 * Creates the user in Supabase Auth and sets their role + company_id.
 *
 * Run this once per user you want to add. You can also create users directly
 * in Supabase Dashboard → Authentication → Users, then set their metadata
 * in the SQL Editor using the UPDATE statement shown at the bottom.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

// ─── Load .env if present ─────────────────────────────────────────────────────

try {
  const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} catch (_) { /* .env not found — rely on shell environment */ }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
  process.exit(1);
}

// ─── Prompt helper ────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function prompt(question, defaultValue) {
  const answer = await rl.question(
    defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `
  );
  return answer.trim() || defaultValue || '';
}

// ─── Supabase Admin API ───────────────────────────────────────────────────────

async function createSupabaseUser({ email, password, role, company_id }) {
  // 1. Create the auth user
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method:  'POST',
    headers: {
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,         // Skip email confirmation
      app_metadata: { role, company_id },
      user_metadata: { role, company_id },
    }),
  });

  const data = await createRes.json();

  if (!createRes.ok) {
    throw new Error(data.message ?? data.error_description ?? JSON.stringify(data));
  }

  return data;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('\n──────────────────────────────────────');
console.log('  Fire Flow — Create User');
console.log('──────────────────────────────────────\n');

const email      = await prompt('Email address');
const password   = await prompt('Password (min 8 chars)');
const role       = await prompt('Role (admin / technician)', 'technician');
const company_id = await prompt('Company ID (e.g. co-acme)');

rl.close();

if (!email || !password || !company_id) {
  console.error('\nError: email, password, and company_id are required.');
  process.exit(1);
}

if (!['admin', 'technician'].includes(role)) {
  console.error('\nError: role must be "admin" or "technician".');
  process.exit(1);
}

console.log(`\nCreating ${role} user: ${email} (company: ${company_id})…`);

try {
  const user = await createSupabaseUser({ email, password, role, company_id });
  console.log('\n✓ User created successfully!');
  console.log(`  ID:         ${user.id}`);
  console.log(`  Email:      ${user.email}`);
  console.log(`  Role:       ${role}`);
  console.log(`  Company:    ${company_id}`);
  console.log('\nThe user can now sign in and get a JWT token via:');
  console.log(`  POST ${SUPABASE_URL}/auth/v1/token?grant_type=password`);
  console.log('  Body: { "email": "...", "password": "..." }');
  console.log('  Use the returned access_token as: Authorization: Bearer <token>\n');
} catch (err) {
  console.error(`\n✗ Failed to create user: ${err.message}`);
  process.exit(1);
}
