'use strict';
// Collects offending field names for VALIDATION_ERROR details.fields.
// A nested path such as "periods.best_of" is reported as the top-level field ("periods"),
// the full dotted path and the leaf name, so callers matching on any of them succeed.

class FieldErrors {
  constructor() {
    this.list = [];
  }

  add(path) {
    const parts = path.split('.');
    const out = [parts[0].replace(/\[\d+\]$/, '')];
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}.${part}` : part;
      out.push(acc);
    }
    if (parts.length > 1) out.push(parts[parts.length - 1].replace(/\[\d+\]$/, ''));
    for (const f of out) if (!this.list.includes(f)) this.list.push(f);
  }

  get ok() {
    return this.list.length === 0;
  }
}

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

module.exports = { FieldErrors, has };
