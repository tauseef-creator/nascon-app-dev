// NFR-2 load profile (spec 6.4): 500 guest viewers + 50 chat posters for 15 s,
// zero failed requests and p95 < 800 ms. Run from the repo root with:
//   k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js
// BASE_URL may be overridden (k6 run -e BASE_URL=http://host:8080 ...); it defaults to
// http://localhost:8080 so the unmodified command behaves exactly as the spec profile.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  scenarios: {
    guest_viewers: {
      executor: 'constant-vus',
      vus: 500,
      duration: '15s',
      exec: 'viewStream',
    },
    chat_posters: {
      executor: 'constant-vus',
      vus: 50,
      duration: '15s',
      exec: 'postChat',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0.00'],
    http_req_duration: ['p(95)<800'],
  },
};

export function viewStream() {
  const res = http.get(`${BASE_URL}/audit/v1/qr/match-m1?inspect=true`);
  check(res, {
    'guest QR status is 200': (r) => r.status === 200,
    'has target_route': (r) => r.json('target_route') !== undefined,
  });
  sleep(0.1);
}

export function postChat() {
  const payload = JSON.stringify({
    chat_room_id: 'chat-cs-session-101',
    incoming_messages: [
      { message_id: `k6-${__VU}-${__ITER}`, sender: `user-${__VU}`, text: 'Live reaction' }
    ],
    check_dlq: false,
  });
  const res = http.post(`${BASE_URL}/audit/v1/moderation/test`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, {
    'chat status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  sleep(0.2);
}
