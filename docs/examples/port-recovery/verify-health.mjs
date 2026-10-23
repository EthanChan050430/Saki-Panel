import assert from 'node:assert/strict';

const url = 'http://127.0.0.1:16541/health';
for (let attempt = 1; attempt <= 3; attempt++) {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  const body = await response.json();
  assert.equal(response.status, 200, 'Expected HTTP 200');
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'Saki Recovery Demo');
  console.log(JSON.stringify({ attempt, at: new Date().toISOString(), url, status: response.status, body }));
  if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000));
}
