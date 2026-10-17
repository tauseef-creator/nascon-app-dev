'use strict';
// Mock payment gateway (spec 5.12, FR-2.3): authorization, capture, failure, refund simulation.
// Pure and deterministic: `seq` is the per-reset payment sequence number supplied by the caller.

const TOKENS = {
  SUCCESS: 'tok_success',
  DECLINED: 'tok_declined',
  CAPTURE_FAIL: 'tok_capture_fail',
};

function mockGateway(token, seq = 1) {
  if (token === TOKENS.SUCCESS) {
    return { authorized: true, captured: true, authorization_id: `auth_${seq}`, capture_id: `cap_${seq}`, state: 'captured', errorCode: null };
  }
  if (token === TOKENS.CAPTURE_FAIL) {
    // Authorization succeeded, capture failed: the authorization is voided.
    return { authorized: true, captured: false, authorization_id: `auth_${seq}`, capture_id: null, state: 'voided', errorCode: 'PAYMENT_CAPTURE_FAILED' };
  }
  // tok_declined and any unknown token: authorization fails.
  return { authorized: false, captured: false, authorization_id: null, capture_id: null, state: 'declined', errorCode: 'PAYMENT_DECLINED' };
}

function mockRefund(captureId, seq = 1) {
  if (typeof captureId !== 'string' || !captureId) return { refunded: false, refund_id: null, state: 'refund_failed' };
  return { refunded: true, refund_id: `ref_${seq}`, state: 'refunded' };
}

const GATEWAY_MESSAGES = {
  PAYMENT_DECLINED: 'Payment authorization was declined.',
  PAYMENT_CAPTURE_FAILED: 'Payment capture failed; the authorization was voided.',
};

module.exports = { TOKENS, mockGateway, mockRefund, GATEWAY_MESSAGES };
