import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createContactApp } from '../server.js';

process.env.SMTP_USER = 'info@btsys.ru';
process.env.CONTACT_TO = 'info@btsys.ru';

const servers = [];
afterEach(async () => Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))));

async function start(transport = { sendMail: async () => ({ messageId: 'test' }) }) {
  const server = createContactApp({ transport }).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, body, forwardedFor = '198.51.100.10') {
  return fetch(`${base}/api/contact`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify(body),
  });
}

const valid = { name: 'Иван', email: 'ivan@example.com', company: '', message: 'Нужен бак', website: '' };

test('health does not disclose configuration', async () => {
  const base = await start();
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('valid request builds the required email', async () => {
  let mail;
  const base = await start({ sendMail: async options => { mail = options; } });
  const response = await post(base, valid);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(mail.from, 'info@btsys.ru');
  assert.equal(mail.to, 'info@btsys.ru');
  assert.equal(mail.replyTo, valid.email);
  assert.equal(mail.subject, 'Заявка с сайта btsys.ru — Иван');
  assert.match(mail.text, /Компания \/ организация:\nне указана/);
});

test('validation rejects invalid fields without a stack trace', async () => {
  for (const body of [
    { ...valid, name: '' },
    { ...valid, email: 'wrong' },
    { ...valid, message: '' },
    { ...valid, company: 'x'.repeat(151) },
  ]) {
    const response = await post(await start(), body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: 'validation' });
  }
});

test('honeypot succeeds without sending mail', async () => {
  let calls = 0;
  const base = await start({ sendMail: async () => { calls += 1; } });
  const response = await post(base, { ...valid, website: 'filled' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 0);
});

test('sixth request from one forwarded client is rate limited', async () => {
  const base = await start();
  for (let attempt = 1; attempt <= 5; attempt += 1) assert.equal((await post(base, valid)).status, 200);
  const response = await post(base, valid);
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { ok: false, error: 'rate_limit' });
});

test('SMTP failure returns only the stable server response', async () => {
  const base = await start({ sendMail: async () => { throw new Error('private SMTP detail'); } });
  const response = await post(base, valid);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: 'server' });
});
