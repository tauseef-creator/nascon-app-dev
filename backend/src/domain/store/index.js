'use strict';
// Store domain (FR-2.3, spec 5.12): pure functions only, no DB or HTTP.
module.exports = {
  ...require('./validation'),
  ...require('./money'),
  ...require('./gateway'),
  ...require('./receipt'),
  ...require('./orderState'),
};
