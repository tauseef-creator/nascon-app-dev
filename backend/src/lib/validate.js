'use strict';
// Small validation helpers. Each check pushes the offending field name into `bad`.

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v) => typeof v === 'string';
const isId = (v) => isStr(v) && ID_RE.test(v);
const isBool = (v) => typeof v === 'boolean';

function isDate(v) {
  if (!isStr(v) || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { ID_RE, isObj, isInt, isStr, isId, isBool, isDate, nowIso, todayDate };
