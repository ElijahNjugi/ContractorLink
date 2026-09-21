// Private handover export: never publish snapshot/ or its ZIP to GitHub.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'backend/package.json'));
const env=require('dotenv').parse(fs.readFileSync(path.join(root,'backend/.env')));
const {Client}=require('pg');
const client=new Client({host:env.DB_HOST,port:Number(env.DB_PORT||5432),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD});
const destination=path.join(root,'snapshot');
fs.mkdirSync(destination,{recursive:true});
const binary=process.env.CONTRACTORLINK_PG_DUMP||'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe';
const result=spawnSync(binary,['--data-only','--column-inserts','--no-owner','--no-privileges','--schema=public','--exclude-table-data=public.password_tokens','--exclude-table-data=public.password_resets','--exclude-table-data=public.launcher_migrations','--file',path.join(destination,'data.sql')],{windowsHide:true,encoding:'utf8',env:{...process.env,PGHOST:env.DB_HOST,PGPORT:env.DB_PORT||'5432',PGDATABASE:env.DB_NAME,PGUSER:env.DB_USER,PGPASSWORD:env.DB_PASSWORD}});
if(result.status!==0)throw new Error('Database export failed; verify the local PostgreSQL service and pg_dump version.');
await client.connect();
try {
  const counts={};
  for(const table of ['organizations','users','tickets','sla_agreements']) counts[table]=Number((await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  const sql=fs.readFileSync(path.join(destination,'data.sql'));
  const manifest={createdAt:new Date().toISOString(),counts,sha256:crypto.createHash('sha256').update(sql).digest('hex')};
  fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
  const uploads=path.join(root,'backend/uploads');
  if(fs.existsSync(uploads))fs.cpSync(uploads,path.join(destination,'uploads'),{recursive:true});
  fs.writeFileSync(path.join(destination,'READ ME.txt'),'Private project snapshot: existing accounts (password hashes), records and uploaded documents. Share only with intended reviewers. Use existing application login credentials supplied separately by Elijah. Server passwords and email/API keys are not included. Copies do not synchronize. Password reset tokens are excluded.\r\n');
  console.log(JSON.stringify(manifest,null,2));
} finally {await client.end();}
