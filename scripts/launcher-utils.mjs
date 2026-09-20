import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

export function fingerprint(root, entries) {
  const hash = crypto.createHash('sha256');
  function visit(relative) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(relative, name));
    } else { hash.update(relative); hash.update(fs.readFileSync(full)); }
  }
  for (const entry of entries) visit(entry);
  return hash.digest('hex');
}
export async function availablePort(preferred) {
  for (let port = preferred; port < preferred + 100; port++) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error(`No free local port near ${preferred}. Close unused local servers and retry.`);
}
export function migrationBody(sql) {
  return sql.replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
}
export function writePrivateJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}
