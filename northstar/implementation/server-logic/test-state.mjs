import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const folder = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(folder, 'request-state.js'), 'utf8');
const id = '00000000-0000-0000-0000-000000000001';
const row = {
  ns_name: 'Draft', ns_description: 'Synthetic',
  ns_reference: 'NS-TEST', ns_publicstatus: 'Draft',
  ns_submissionstatus: 729100000, '@odata.etag': 'W/"9007199254740993"',
  secret: 'never public', _ownerid_value: 'never public'
};
let tests = 0;
function run(options = {}) {
  const calls = [];
  const context = { Server: {
    User: 'user' in options ? options.user : { contactid: id },
    Context: { QueryParameters: { id: 'id' in options ? options.id : id } },
    Connector: { Dataverse: { RetrieveRecord: (...args) => {
      calls.push(args);
      return options.raw ?? JSON.stringify({ IsSuccessStatusCode: true,
        StatusCode: 200, Body: JSON.stringify(options.row ?? row) });
    } } }, Logger: { Error() {} }
  } };
  vm.createContext(context); vm.runInContext(source, context);
  tests++; return { value: JSON.parse(context.get()), calls };
}
const good = run();
assert.equal(good.value.request.rowVersion, '9007199254740993');
assert.equal(good.value.request.id, id);
assert.equal(good.calls[0][3], true);
assert.equal('secret' in good.value.request, false);
assert.equal('_ownerid_value' in good.value.request, false);
for (const value of [null, undefined, '', 'bad', id + '?x=1',
  '00000000-0000-0000-0000-000000000000', {}, []]) {
  const r = run({ id: value });
  assert.equal(r.value.ok, false); assert.equal(r.calls.length, 0);
}
assert.equal(run({ user: null }).calls.length, 0);
for (const raw of ['null', '{}', 'broken', JSON.stringify({
  IsSuccessStatusCode: false, StatusCode: 403, Body: { error: 'secret' }
}), JSON.stringify({ IsSuccessStatusCode: true, StatusCode: 200,
  ServerError: true, Body: JSON.stringify(row) })]) {
  assert.deepEqual(run({ raw }).value, { ok: false, code: 'UNAVAILABLE' });
}
for (const etag of [null, '', '123', 'W/"-1"', 'W/"1x"',
  'W/"' + '1'.repeat(33) + '"']) {
  assert.equal(run({ row: { ...row, '@odata.etag': etag } }).value.ok, false);
}
for (const state of [null, -1, 0, '729100000', 729100003]) {
  assert.equal(run({ row: { ...row, ns_submissionstatus: state } }).value.ok, false);
}
console.log(`${tests} request-state cases passed; no tenant claim.`);
