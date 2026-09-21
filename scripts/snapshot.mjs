import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export async function importSnapshot(client, root, runtime) {
  const folder=path.join(root,'snapshot');
  if(!fs.existsSync(path.join(folder,'manifest.json')))return false;
  await client.query('CREATE TABLE IF NOT EXISTS launcher_snapshot (id integer PRIMARY KEY CHECK(id=1), imported_at timestamptz DEFAULT now())');
  if((await client.query('SELECT 1 FROM launcher_snapshot WHERE id=1')).rowCount)return true;
  if(Number((await client.query('SELECT count(*) FROM users')).rows[0].count)>0)return false;
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  const buffer=fs.readFileSync(path.join(folder,'data.sql'));
  if(crypto.createHash('sha256').update(buffer).digest('hex')!==manifest.sha256)throw new Error('Snapshot checksum mismatch. Extract a fresh project ZIP.');
  const sql=buffer.toString('utf8').replace(/^\\(?:un)?restrict[^\r\n]*$/gm,'');
  console.log('Importing supplied project records (first launch only) ...');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL session_replication_role = 'replica'");
    const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('launcher_migrations','launcher_snapshot')")).rows;
    const names=tables.map(({tablename})=>'public."'+tablename.replaceAll('"','""')+'"');
    if(names.length)await client.query('TRUNCATE '+names.join(',')+' CASCADE');
    await client.query(sql);
    await client.query('SET search_path TO public');
    for(const [table,count] of Object.entries(manifest.counts)) {
      if(!['organizations','users','tickets','sla_agreements'].includes(table))throw new Error('Invalid snapshot table');
      if(Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count)!==count)throw new Error('Snapshot row count mismatch: '+table);
    }
    if(fs.existsSync(path.join(folder,'uploads')))fs.cpSync(path.join(folder,'uploads'),path.join(runtime,'uploads'),{recursive:true});
    await client.query('INSERT INTO launcher_snapshot(id) VALUES(1)');
    await client.query('COMMIT');
    fs.writeFileSync(path.join(runtime,'First login.txt'),'Use the existing account email and password supplied separately by Elijah.\r\nChanges are saved locally and do not synchronize with other copies.\r\n');
    return true;
  } catch(error) {await client.query('ROLLBACK');throw error;}
}
