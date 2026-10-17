'use strict';
// In-process realtime hub. Emits ('match', matchId) after a committed event append
// and ('pinned', matchId) after a product pin. Consumed by the SSE route.
const { EventEmitter } = require('events');

const hub = new EventEmitter();
hub.setMaxListeners(0);

module.exports = { hub };
