const assert = require('node:assert/strict');
const C = require('../src/core.js');
assert.equal(C.key('form', '{ABC}'), 'form:abc');
const edges = [
  { from: 'view:a', to: 'field:account.name' },
  { from: 'view:b', to: 'field:account.name' },
  { from: 'field:account.name', to: 'table:account' },
];
assert.equal(C.relations(edges, 'field:account.name', 'usedby').length, 2);
assert.equal(C.relations(edges, 'field:account.name', 'uses').length, 1);
assert.match(C.csv([{ name: 'A,"quoted"\nname' }]), /"A,""quoted""\nname"/);
console.log('Core tests passed: keys, dependency direction, CSV escaping');
