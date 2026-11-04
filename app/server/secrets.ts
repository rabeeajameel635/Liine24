// Secrets (OAuth tokens and client registrations) live in the macOS Keychain via the `security` CLI.
// On other systems (development only) they fall back to a 0600 file in the data folder, and the UI says so.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const SERVICE = 'Ghorfa';
export const keychainAvailable = process.platform === 'darwin';

let dataDir = '';
export function initSecrets(dir: string) { dataDir = dir; }
const file = () => join(dataDir, 'secrets.dev.json');
async function readFileStore(): Promise<Record<string, string>> { try { return JSON.parse(await readFile(file(), 'utf8')); } catch { return {}; } }

export async function getSecret(account: string): Promise<string | null> {
  if (keychainAvailable) {
    try { const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']); return stdout.replace(/\n$/, ''); }
    catch { return null; }
  }
  return (await readFileStore())[account] ?? null;
}

export async function setSecret(account: string, value: string): Promise<void> {
  if (keychainAvailable) { await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value]); return; }
  const s = await readFileStore(); s[account] = value; await writeFile(file(), JSON.stringify(s)); await chmod(file(), 0o600);
}

export async function deleteSecret(account: string): Promise<void> {
  if (keychainAvailable) { await run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]).catch(() => {}); return; }
  const s = await readFileStore(); delete s[account]; await writeFile(file(), JSON.stringify(s)); await chmod(file(), 0o600);
}
