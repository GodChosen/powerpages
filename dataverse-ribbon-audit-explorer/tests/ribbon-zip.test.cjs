const assert = require('node:assert/strict'),
  zlib = require('node:zlib'),
  Cmd = require('../src/commands.js');
function archive(text, method) {
  const data = Buffer.from(text),
    packed = method === 8 ? zlib.deflateRawSync(data) : data,
    name = Buffer.from('ribbon.xml'),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return Buffer.concat([local, name, packed, central, name, end]).toString('base64');
}
(async () => {
  for (const method of [0, 8])
    assert.deepEqual(await Cmd.unzipXml(archive('<Ribbon/>', method)), ['<Ribbon/>']);
  await assert.rejects(() => Cmd.unzipXml(Buffer.from('invalid').toString('base64')));
  console.log('Ribbon ZIP tests passed: stored and deflate XML, malformed archive rejection.');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
