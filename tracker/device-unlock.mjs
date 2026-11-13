import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Never pass passwords in process arguments, environment variables, or shell commands.
function run(file, args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const timer = setTimeout(() => child.kill(), 60_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 100_000) child.kill();
    });
    child.stderr.resume(); // OS diagnostics can include sensitive input; never relay them.
    child.stdin.on('error', () => {});
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Device storage unavailable'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
    child.stdin.end(input);
  });
}

const service = 'local.chinaslop.tracker.unlock';
const failure = () =>
  new Error('Could not access secure device storage. Enter your password to unlock.');

export function createDeviceUnlock(
  directory,
  {
    platform = process.platform,
    execute = run,
    disabled = process.env.TRACKER_DISABLE_AUTO_UNLOCK === '1',
  } = {},
) {
  // Separate installations and the demo must never share an unlock credential.
  const account = createHash('sha256').update(path.resolve(directory)).digest('hex');
  const supported = !disabled && ['darwin', 'win32'].includes(platform);
  const provider =
    platform === 'darwin'
      ? 'macOS Keychain'
      : platform === 'win32'
        ? 'Windows protected storage'
        : '';
  const protectedPath = path.join(directory, 'device-unlock.dpapi');
  async function windows(operation, value) {
    const script = `$ErrorActionPreference='Stop'; try {
      Add-Type -AssemblyName System.Security;
      $inputValue=[Console]::In.ReadToEnd();
      $bytes=[Convert]::FromBase64String($inputValue);
      $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);
      [Console]::Out.Write([Convert]::ToBase64String($result));
    } catch { exit 1 }`;
    const executable = path.win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const result = await execute(
      executable,
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      value,
    );
    if (result.code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.output.trim())) throw failure();
    return result.output.trim();
  }
  async function read() {
    if (!supported) return null;
    if (platform === 'darwin') {
      const result = await execute('/usr/bin/security', [
        'find-generic-password',
        '-s',
        service,
        '-a',
        account,
        '-w',
      ]);
      if (result.code === 44) return null; // No remembered password yet.
      if (result.code !== 0 || !/^v1:[A-Za-z0-9+/]+={0,2}$/.test(result.output.trim()))
        throw failure();
      return Buffer.from(result.output.trim().slice(3), 'base64').toString('utf8');
    }
    let blob;
    try {
      blob = await fs.readFile(protectedPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw failure();
    }
    return Buffer.from(await windows('Unprotect', blob), 'base64').toString('utf8');
  }
  async function write(password) {
    if (!supported) return;
    if (typeof password !== 'string' || !password) throw failure();
    const encoded = Buffer.from(password, 'utf8').toString('base64');
    if (platform === 'darwin') {
      // Interactive mode reads this one command from a pipe, so the secret is not
      // exposed in argv. Base64 keeps quotes/newlines out of its command parser.
      await execute(
        '/usr/bin/security',
        ['-i'],
        `add-generic-password -U -s ${service} -a ${account} -w v1:${encoded}\n`,
      );
      // Interactive security may exit successfully even if an individual command failed.
      if ((await read()) !== password) throw failure();
    } else {
      const blob = await windows('Protect', encoded);
      const temporary = protectedPath + '.tmp';
      await fs.writeFile(temporary, blob, { mode: 0o600 });
      await fs.rename(temporary, protectedPath);
    }
  }
  return { supported, provider: supported ? provider : '', read, write };
}
