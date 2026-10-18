'use strict';
// Progressive registration (FR-4.4): a guest converts to a registered member, and the staged guest
// cart is merged into the new member cart. Pure functions only: no DB, no HTTP.
const { isObj, isStr } = require('../../lib/validate');
const { isGuestTokenFormat } = require('./guest');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MAX_EMAIL = 254;
const MAX_NAME = 80;
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
// Self-registered members are fans: the least privileged role of the RBAC matrix.
const REGISTERED_ROLE = 'viewer';

const optional = (v) => v === undefined || v === null;

/**
 * Schema check of POST /api/v1/auth/register.
 * Body: { email, password, display_name?, tenant_id?, guest_token? }.
 * Returns { ok, fields, value } with the email trimmed and lowercased.
 */
function validateRegisterBody(body) {
  if (!isObj(body)) return { ok: false, fields: ['body'], value: null };
  const bad = [];
  const email = isStr(body.email) ? body.email.trim().toLowerCase() : null;
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) bad.push('email');
  if (!isStr(body.password) || body.password.length < MIN_PASSWORD || body.password.length > MAX_PASSWORD) bad.push('password');
  const name = isStr(body.display_name) ? body.display_name.trim() : body.display_name;
  if (!optional(name) && (!isStr(name) || name.length === 0 || name.length > MAX_NAME)) bad.push('display_name');
  if (!optional(body.tenant_id) && (!isStr(body.tenant_id) || !ID_RE.test(body.tenant_id))) bad.push('tenant_id');
  if (!optional(body.guest_token) && !isGuestTokenFormat(body.guest_token)) bad.push('guest_token');
  if (bad.length) return { ok: false, fields: bad, value: null };
  return {
    ok: true,
    fields: [],
    value: {
      email,
      password: body.password,
      display_name: optional(name) ? email.split('@')[0] : name,
      tenant_id: optional(body.tenant_id) ? null : body.tenant_id,
      guest_token: optional(body.guest_token) ? null : body.guest_token,
    },
  };
}

// New member id from caller-supplied random hex.
function newUserId(randomHex) {
  return `user-${randomHex}`;
}

module.exports = { REGISTERED_ROLE, MIN_PASSWORD, validateRegisterBody, newUserId };
