import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.distribution');
fs.mkdirSync(output,{recursive:true});
const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'');
const destination=path.join(output,`ContractorLink-${stamp}`);
const folder=path.join(destination,'ContractorLink');
fs.mkdirSync(folder,{recursive:true});
const entries=['backend','frontend','database','ml','scripts','package.json','package-lock.json','.gitignore','.gitattributes','README.md','START HERE.txt','Launch ContractorLink.cmd','Stop ContractorLink.cmd','Open ContractorLink.url'];
const omitted=new Set(['node_modules','.venv','.runtime','.distribution','.git','dist','uploads','__pycache__','incident_event_log.csv']);
const files=[];
function copy(relative) {
  const name=path.basename(relative);
  if(omitted.has(name)||(name.startsWith('.env')&&name!=='.env.example')||/\.(log|pyc|zip)$/i.test(name))return;
  const source=path.join(root,relative),target=path.join(folder,relative);
  if(!fs.existsSync(source))throw new Error(`Required source missing: ${relative}`);
  if(fs.statSync(source).isDirectory()) {fs.mkdirSync(target,{recursive:true});for(const item of fs.readdirSync(source))copy(path.join(relative,item));}
  else {fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);files.push(relative.replaceAll('\\','/'));}
}
for(const entry of entries)copy(entry);
for(const name of files) {
  if(/(^|\/)(\.env|node_modules|uploads|\.runtime)(\/|$)/.test(name))throw new Error(`Private file entered export: ${name}`);
  if(fs.statSync(path.join(folder,name)).size>95*1024*1024)throw new Error(`File exceeds GitHub size budget: ${name}`);
}
// Check known credential shapes without printing any matched values.
const secrets=/(?:sk-proj-[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/;
for(const name of files.filter(n=>/\.(?:js|jsx|json|mjs|ps1|txt|md|sql)$/.test(n)&&n!=='scripts/package.mjs')) {
  if(secrets.test(fs.readFileSync(path.join(folder,name),'utf8')))throw new Error(`Potential credential detected in ${name}; export stopped.`);
}
const zip=path.join(output,'ContractorLink-Windows.zip');
const result=spawnSync('powershell.exe',['-NoProfile','-Command','Compress-Archive -LiteralPath $env:CONTRACTORLINK_PACKAGE_SOURCE -DestinationPath $env:CONTRACTORLINK_PACKAGE_ZIP -Force'],{
  windowsHide:true,stdio:'inherit',env:{...process.env,CONTRACTORLINK_PACKAGE_SOURCE:folder,CONTRACTORLINK_PACKAGE_ZIP:zip},
});
if(result.status!==0)throw new Error('ZIP creation failed.');
const metadata={folder,zip,fileCount:files.length,bytes:fs.statSync(zip).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),files};
fs.writeFileSync(path.join(output,'latest-package.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify({...metadata,files:undefined},null,2));
