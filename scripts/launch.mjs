import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { availablePort, fingerprint, migrationBody, writePrivateJson } from './launcher-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, '.runtime');
fs.mkdirSync(path.join(runtime, 'logs'), { recursive: true });
const statePath = path.join(runtime, 'instance.json');
const lockPath = path.join(runtime, 'session.lock');
const noBrowser = process.argv.includes('--no-browser');
let database, backend, control, locked = false, stopping = false, ready = false;
let instance, backendExited = false;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function browser(url) {
  if (noBrowser) return;
  spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:CONTRACTORLINK_URL'], {
    windowsHide: true, stdio: 'ignore', env: { ...process.env, CONTRACTORLINK_URL: url },
  }).on('error', () => console.log(`Open your browser at ${url}`));
}
async function contact(state, action) {
  if (!state?.controlPort || !state.token) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(2000),
    });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (exit ${code}).`)));
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true; ready = false;
  console.log('\nStopping ContractorLink ...');
  if (backend && !backendExited) {
    if (backend.connected) backend.send('contractorlink:shutdown');
    else backend.kill();
    await Promise.race([new Promise(resolve => backend.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 4000))]);
    if (!backendExited) backend.kill();
  }
  if (database) { try { await database.stop(); } catch (error) { console.error('Database shutdown:', error.message); code = 1; } }
  control?.close();
  if (instance && readJson(statePath)?.token === instance.token) fs.unlinkSync(statePath);
  if (locked && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  process.exit(code);
}
async function installDependencies(folder) {
  const cwd = path.join(root, folder);
  const hash = fingerprint(cwd, ['package.json', 'package-lock.json']);
  const stamp = path.join(runtime, `${folder}-dependencies.txt`);
  if (fs.existsSync(path.join(cwd, 'node_modules')) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === hash) return;
  console.log(`Installing ${folder} dependencies ...`);
  const npm = process.env.CONTRACTORLINK_NPM_CLI || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  await run(process.execPath, [npm, 'ci', '--no-audit', '--no-fund'], { cwd });
  fs.writeFileSync(stamp, hash);
}
async function initializeData(config, port) {
  const require = createRequire(path.join(root, 'backend/package.json'));
  const { Client } = require('pg');
  const bcrypt = require('bcrypt');
  const options = { host: '127.0.0.1', port, user: 'contractorlink', password: config.databasePassword };
  const admin = new Client({ ...options, database: 'postgres' });
  await admin.connect();
  const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname='contractorlink'");
  if (!existing.rowCount) await admin.query('CREATE DATABASE contractorlink');
  await admin.end();
  const client = new Client({ ...options, database: 'contractorlink' });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS launcher_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())');
    const sqlFiles = ['schema.sql', ...fs.readdirSync(path.join(root, 'database')).filter(x => /^\d{4}-.*\.sql$/.test(x)).sort()];
    for (const name of sqlFiles) {
      const sql = fs.readFileSync(path.join(root, 'database', name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('SELECT checksum FROM launcher_migrations WHERE name=$1', [name]);
      if (applied.rowCount) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`Previously applied migration ${name} has changed. Keep your data and ask the project maintainer to provide an upgrade migration.`);
        continue;
      }
      console.log(`Preparing database: ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(migrationBody(sql));
        await client.query('INSERT INTO launcher_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    await client.query('BEGIN');
    for (const [code, name] of [['SUPER_ADMIN','Super Admin'],['ORG_ADMIN','Organization Admin'],['ORG_STAFF','Organization Staff'],['DIRECTOR','Director'],['APPLICANT_REP','Applicant Representative']]) {
      await client.query('INSERT INTO roles(code,name) VALUES($1,$2) ON CONFLICT(code) DO NOTHING', [code,name]);
    }
    await client.query("INSERT INTO organizations(name,organization_type,email) VALUES('Platform Internal','PLATFORM_INTERNAL','admin@contractorlink.local') ON CONFLICT(name) DO NOTHING");
    const result = await client.query(`INSERT INTO users(organization_id,role_id,full_name,email,password_hash,is_active,must_change_password)
      SELECT o.id,r.id,'Local Administrator','admin@contractorlink.local',$1,TRUE,TRUE
      FROM organizations o CROSS JOIN roles r WHERE o.name='Platform Internal' AND r.code='SUPER_ADMIN'
      ON CONFLICT(email) DO NOTHING RETURNING id`, [await bcrypt.hash(config.initialPassword, 10)]);
    await client.query('COMMIT');
    if (result.rowCount) {
      fs.writeFileSync(path.join(runtime, 'First login.txt'), `ContractorLink local installation\r\nEmail: admin@contractorlink.local\r\nInitial password: ${config.initialPassword}\r\nChange this password at first login. This file is not updated after a password change.\r\n`, {mode:0o600});
    }
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { await client.end(); }
}

async function main() {
  const previous = readJson(statePath);
  const status = await contact(previous, 'status');
  if (process.argv.includes('--stop')) {
    if (status?.root === root) { await contact(previous, 'stop'); console.log('Shutdown requested.'); }
    else console.log('No running launcher found for this folder.');
    return;
  }
  if (status?.root === root) {
    if (status.ready) browser(status.url);
    console.log(status.ready ? `Already running: ${status.url}` : 'Setup is already in progress. Please wait in the first launcher window.');
    return;
  }
  try { fs.writeFileSync(lockPath, JSON.stringify({pid:process.pid}), {flag:'wx'}); locked=true; }
  catch {
    const old = readJson(lockPath);
    if (!old?.pid) throw new Error('A startup lock is present. Wait for the other launcher or restart Windows and retry.');
    let alive = true; try { process.kill(old.pid,0); } catch(error) { if (error.code === 'ESRCH') alive=false; }
    if (alive) throw new Error('Another launcher process is still running. Use Stop ContractorLink or wait for its setup to finish.');
    fs.unlinkSync(lockPath);
    fs.writeFileSync(lockPath, JSON.stringify({pid:process.pid}), {flag:'wx'}); locked=true;
  }
  for (const signal of ['SIGINT','SIGTERM','SIGBREAK']) process.on(signal, () => stop());
  await installDependencies('backend');
  await installDependencies('frontend');
  const buildHash = fingerprint(path.join(root, 'frontend'), ['src','public','index.html','vite.config.js','package-lock.json']);
  const buildStamp = path.join(runtime, 'frontend-build.txt');
  if (!fs.existsSync(path.join(root,'frontend/dist/index.html')) || !fs.existsSync(buildStamp) || fs.readFileSync(buildStamp,'utf8') !== buildHash) {
    console.log('Building the website ...');
    await run(process.execPath, [path.join(root,'frontend/node_modules/vite/bin/vite.js'),'build'], {
      cwd:path.join(root,'frontend'), env:{...process.env,VITE_API_BASE_URL:'/api'},
    });
    fs.writeFileSync(buildStamp,buildHash);
  }
  const configFile = path.join(runtime,'config.json');
  let config=readJson(configFile);
  if (!config) {
    config={databasePassword:crypto.randomBytes(32).toString('hex'),jwtSecret:crypto.randomBytes(48).toString('hex'),initialPassword:'Cl!'+crypto.randomBytes(12).toString('base64url')+'9a'};
    writePrivateJson(configFile,config);
  }
  const databasePort=await availablePort(55432);
  const port=await availablePort(5173);
  const url=`http://127.0.0.1:${port}`;
  const {default:EmbeddedPostgres}=await import('embedded-postgres');
  const {pg_ctl}=await import('@embedded-postgres/windows-x64');
  const dbLog=fs.createWriteStream(path.join(runtime,'logs/database.log'),{flags:'a'});
  database=new EmbeddedPostgres({databaseDir:path.join(runtime,'database'),user:'contractorlink',password:config.databasePassword,port:databasePort,persistent:true,authMethod:'scram-sha-256',
    initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],
    onLog:message=>dbLog.write(String(message)+'\n'),onError:message=>dbLog.write(String(message)+'\n')});
  if (!fs.existsSync(path.join(runtime,'database/PG_VERSION'))) await database.initialise();
  // Recover only this folder's cluster after an interrupted previous launcher.
  const dbStatus=spawnSync(pg_ctl,['status','-D',path.join(runtime,'database')],{windowsHide:true,stdio:'ignore'});
  if(dbStatus.status===0) await run(pg_ctl,['stop','-D',path.join(runtime,'database'),'-m','fast','-w','-t','30']);
  await database.start();
  let dbStarted=true;
  // pg_ctl requests a clean checkpoint; the dependency's Windows default force-kills.
  database.stop=async()=>{
    if(!dbStarted)return;
    await run(pg_ctl,['stop','-D',path.join(runtime,'database'),'-m','fast','-w','-t','30']);
    dbStarted=false;
  };
  await initializeData(config,databasePort);
  const log=fs.openSync(path.join(runtime,'logs/backend.log'),'a');
  backend=spawn(process.execPath,[path.join(root,'backend/src/server.js')],{cwd:path.join(root,'backend'),windowsHide:true,stdio:['ignore',log,log,'ipc'],env:{...process.env,
    PORT:String(port),HOST:'127.0.0.1',SERVE_FRONTEND:'true',DB_HOST:'127.0.0.1',DB_PORT:String(databasePort),DB_NAME:'contractorlink',DB_USER:'contractorlink',DB_PASSWORD:config.databasePassword,
    JWT_SECRET:config.jwtSecret,APP_BASE_URL:url,UPLOAD_ROOT:path.join(runtime,'uploads'),PYTHON_EXECUTABLE:process.env.PYTHON_EXECUTABLE||path.join(runtime,'venv/Scripts/python.exe'),
    MAIL_HOST:'',MAIL_USER:'',MAIL_PASS:'',MAIL_FROM:'',AI_PROVIDER:'guided',OPENAI_API_KEY:'',
  }});
  backend.once('exit',code=>{backendExited=true;if (!stopping) {console.error(`Backend stopped (${code}). See .runtime/logs/backend.log`);stop(1);}});
  backend.once('error',error=>{console.error(error.message);stop(1);});
  instance={token:crypto.randomBytes(32).toString('hex'),root,url,pid:process.pid,controlPort:0};
  control=http.createServer((req,res)=>{
    if(req.headers.authorization!==`Bearer ${instance.token}`) {res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/status') res.end(JSON.stringify({root,url,ready}));
    else if(req.url==='/stop'&&req.method==='POST') {res.end(JSON.stringify({ok:true}));setTimeout(()=>stop(),100);}
    else {res.writeHead(404);res.end('{}');}
  });
  await new Promise(resolve=>control.listen(0,'127.0.0.1',resolve));
  instance.controlPort=control.address().port;writePrivateJson(statePath,instance);
  for(let i=0;i<90;i++) {
    if(backendExited) throw new Error('Backend failed to start. See the backend log.');
    try {
      const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});
      if(response.ok&&(await response.json()).database==='connected') {ready=true;break;}
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!ready) throw new Error('Website did not become ready. See .runtime/logs/backend.log.');
  fs.writeFileSync(path.join(runtime,'Open ContractorLink.url'),`[InternetShortcut]\r\nURL=${url}\r\n`);
  console.log(`\nContractorLink is ready: ${url}\nFirst login details: .runtime/First login.txt\nKeep this window open. Use Stop ContractorLink.cmd or press Ctrl+C when finished.\n`);
  browser(url);
}
main().catch(async error=>{console.error(`\nLaunch failed: ${error.message}`);await stop(1);});
