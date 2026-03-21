import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '3m',
};

export default function () {
  // Test homepage
  const res1 = http.get('http://138.197.62.176');
  check(res1, { 'homepage status 200': (r) => r.status === 200 });

  // Test compare endpoint
  const payload = JSON.stringify({
    workload: 'web_app',
    tier: 'medium',
  });

  const res2 = http.post('http://138.197.62.176/compare', payload, {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res2, {
    'compare status 200': (r) => r.status === 200,
    'savings returned': (r) => JSON.parse(r.body).savings !== undefined,
  });

  sleep(1);
}
