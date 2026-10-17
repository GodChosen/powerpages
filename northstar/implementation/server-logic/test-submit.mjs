import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const folder = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(folder, 'submit-request.js'), 'utf8');
const contact = '00000000-0000-0000-0000-000000000001';
const id = '00000000-0000-0000-0000-000000000002';
const body = { id, rowVersion: '123456' };
const envelope = (status = 200) => JSON.stringify({
  StatusCode: status, IsSuccessStatusCode: status < 300,
  ServerError: false, Body: '{}'
});
let count = 0;
function run(value = body, options = {}) {
  const calls = [];
  const logs = [];
  const context = { Server: {
    SiteSetting: { Get: () => options.gate ?? 'verified-v1' },
    User: 'user' in options ? options.user : { contactid: contact },
    Context: { Body: options.raw ?? JSON.stringify(value) },
    Connector: { Dataverse: {
      RetrieveRecord: (...args) => {
        calls.push(['read', ...args]);
        return options.read ?? envelope();
      },
      InvokeCustomApi: (...args) => {
        calls.push(['api', ...args]);
        return options.api ?? envelope();
      }
    } },
    Logger: { Error: message => logs.push(message) }
  } };
  vm.createContext(context);
  vm.runInContext(source, context);
  const result = JSON.parse(context.post());
  count++;
  return { result, calls, logs };
}
const good = run();
assert.deepEqual(good.result, { ok: true, status: 'submitted' });
assert.deepEqual(good.calls[0], [
  'read', 'ns_requests', id, '$select=ns_requestid', true
]);
assert.deepEqual(good.calls[1].slice(0, 3), [
  'api', 'post', `ns_requests(${id})/Microsoft.Dynamics.CRM.ns_SubmitRequest`
]);
assert.deepEqual(JSON.parse(good.calls[1][3]), {
  CallerContact: contact, ExpectedRowVersion: body.rowVersion
});
for (const gate of ['', 'pending', 'wrong']) {
  const r = run(body, { gate });
  assert.equal(r.result.code, 'NOT_CONFIGURED');
  assert.equal(r.calls.length, 0);
}
for (const user of [null, {}, { id: contact }, { contactid: 12 },
  { contactid: '00000000-0000-0000-0000-000000000000' }]) {
  const r = run(body, { user });
  assert.equal(r.result.code, 'NOT_AUTHORIZED');
  assert.equal(r.calls.length, 0);
}
for (const value of [null, [], 1, 'x', {}, { id },
  { ...body, CallerContact: contact }, { ...body, table: 'contacts' },
  { ...body, id: id + '?$expand=contact' },
  { ...body, id: '00000000-0000-0000-0000-000000000000' },
  { ...body, rowVersion: 12 }, { ...body, rowVersion: '' },
  { ...body, rowVersion: 'W/"12"' },
  { ...body, rowVersion: '1'.repeat(33) }]) {
  const r = run(value);
  assert.equal(r.result.code, 'INVALID_INPUT');
  assert.equal(r.calls.length, 0);
}
for (const read of [envelope(403), '{}', 'null', 'broken',
  JSON.stringify({ StatusCode: 200, IsSuccessStatusCode: true,
    ServerError: true })]) {
  const r = run(body, { read });
  assert.equal(r.result.ok, false);
  assert.equal(r.calls.filter(c => c[0] === 'api').length, 0);
  assert.equal(JSON.stringify(r.result).includes('broken'), false);
}
for (const api of [envelope(403), '{}', 'null', 'broken',
  JSON.stringify({ StatusCode: 201, IsSuccessStatusCode: true })]) {
  const r = run(body, { api });
  assert.deepEqual(r.result, { ok: false, code: 'SUBMIT_FAILED' });
  assert.equal(JSON.stringify(r.result).includes('broken'), false);
}
const malformed = run(body, { raw: '{' });
assert.equal(malformed.result.ok, false);
assert.equal(malformed.calls.length, 0);
console.log(`${count} submit-proxy cases passed; no tenant claim.`);
