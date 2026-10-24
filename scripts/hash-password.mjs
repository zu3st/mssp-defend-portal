// Prints a scrypt hash for PORTAL_USERS / PORTAL_USERS_FILE.
// Usage (inside Docker): docker run --rm -it -v "$PWD/scripts:/s:ro" node:24-alpine node /s/hash-password.mjs
// Keep in sync with src/lib/server/auth.ts#hashPassword.
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const rl = createInterface({ input: process.stdin, output: process.stderr });
const password = process.argv[2] ?? (await rl.question('Password: '));
rl.close();
if (password.length < 12) {
	console.error('Use at least 12 characters.');
	process.exit(1);
}
const [N, r, p] = [16384, 8, 1];
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N, r, p });
console.log(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
