import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { availablePort, fingerprint, migrationBody } from './launcher-utils.mjs';

test('port selection avoids an occupied local port', async () => {
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { assert.notEqual(await availablePort(server.address().port),server.address().port); }
  finally { server.close(); }
});
test('migration wrapper preserves SQL blocks while removing only outer transactions',()=>{
  const sql="BEGIN;\nDO $$ BEGIN\nPERFORM 1;\nEND $$;\nCOMMIT;\n";
  assert.equal(migrationBody(sql).trim(),'DO $$ BEGIN\nPERFORM 1;\nEND $$;');
});
test('build fingerprint changes when nested application source changes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'contractorlink-test-'));
  const file=path.join(dir,'source.txt');
  try {fs.writeFileSync(file,'one');const a=fingerprint(dir,['source.txt']);fs.writeFileSync(file,'two');assert.notEqual(a,fingerprint(dir,['source.txt']));}
  finally {fs.unlinkSync(file);fs.rmdirSync(dir);}
});
