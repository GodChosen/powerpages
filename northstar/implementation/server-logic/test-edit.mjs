import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(folder, 'edit-request-draft.js'), 'utf8');
const contact = '00000000-0000-0000-0000-000000000001';
const id = '00000000-0000-0000-0000-000000000002';
const valid = { id, rowVersion: '123', name: ' Edited ', description: ' Text ' };
let count = 0;
function run(body = valid, options = {}) {
  const calls = [];
  const context = { Server: {
    SiteSetting: { Get: () => options.gate ?? 'verified-v1' },
    User: 'user' in options ? options.user : { contactid: contact },
    Context: { Body: options.raw ?? JSON.stringify(body) },
    Connector: { Dataverse: {
      RetrieveRecord: (...args) => {
        calls.push(['read', ...args]);
        return JSON.stringify({ StatusCode: options.readStatus ?? 200,
          IsSuccessStatusCode: (options.readStatus ?? 200) === 200 });
      },
      InvokeCustomApi: (...args) => {
        calls.push(['api', ...args]);
        return options.api ?? JSON.stringify({ StatusCode: 200,
          IsSuccessStatusCode: true });
      }
    } }, Logger: { Error() {} }
  } };
  vm.createContext(context); vm.runInContext(source, context); count++;
  return { result: JSON.parse(context.post()), calls };
}
const good = run();
assert.deepEqual(good.result, { ok: true, status: 'draft' });
assert.equal(good.calls[1][2], `ns_requests(${id})/Microsoft.Dynamics.CRM.ns_EditRequestDraft`);
assert.deepEqual(JSON.parse(good.calls[1][3]), { CallerContact: contact,
  ExpectedRowVersion: '123', Name: 'Edited', Description: 'Text' });
for (const [key, value] of [['name', ''], ['description', ' '], ['name', 1],
  ['description', null], ['name', 'x'.repeat(201)], ['description', 'x'.repeat(4001)],
  ['id', id + '?x=y'], ['rowVersion', 'W/"12"'], ['CallerContact', contact],
  ['ns_contact', contact], ['status', 'submitted']]) {
  const r = run({ ...valid, [key]: value });
  assert.equal(r.result.code, 'INVALID_INPUT'); assert.equal(r.calls.length, 0);
}
assert.equal(run({ ...valid, name: 'x'.repeat(200), description: 'x'.repeat(4000) }).result.ok, true);
for (const body of [null, [], {}, 12, 'value']) {
  assert.equal(run(body).calls.length, 0);
}
assert.equal(run(valid, { gate: 'pending' }).calls.length, 0);
assert.equal(run(valid, { user: null }).calls.length, 0);
assert.equal(run(valid, { readStatus: 403 }).calls.filter(x => x[0] === 'api').length, 0);
assert.deepEqual(run(valid, { api: '{' }).result, { ok: false, code: 'EDIT_FAILED' });
console.log(`${count} draft-edit proxy cases passed; no tenant claim.`);
