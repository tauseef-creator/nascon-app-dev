// Short k6 smoke for CI: the same request functions and thresholds as tests/k6_load.js
// (the committed spec 6.4 profile), scaled to 50 VUs for 10 s.
import { viewStream, postChat } from '../../tests/k6_load.js';

export { viewStream, postChat };

export const options = {
  scenarios: {
    guest_viewers: { executor: 'constant-vus', vus: 45, duration: '10s', exec: 'viewStream' },
    chat_posters: { executor: 'constant-vus', vus: 5, duration: '10s', exec: 'postChat' },
  },
  thresholds: {
    http_req_failed: ['rate==0.00'],
    http_req_duration: ['p(95)<800'],
  },
};
