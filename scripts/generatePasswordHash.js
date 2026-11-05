#!/usr/bin/env node

/**
 * Administrator Password Hash Generator
 * 
 * Usage:
 *   node scripts/generatePasswordHash.js "YourStrongPasswordHere"
 *   npm run set-password "YourStrongPasswordHere"
 */

import bcrypt from 'bcryptjs';

const password = process.argv[2];

if (!password) {
  console.error('\nUsage: node scripts/generatePasswordHash.js <YourPassword>');
  console.error('Example: node scripts/generatePasswordHash.js "MySecurePass123!"\n');
  process.exit(1);
}

if (password.length < 8) {
  console.warn('\n[WARNING] It is strongly recommended to use a password with at least 8 characters.\n');
}

console.log('\nGenerating secure Bcrypt hash (Cost factor 12)...');
const salt = bcrypt.genSaltSync(12);
const hash = bcrypt.hashSync(password, salt);

console.log('--------------------------------------------------');
console.log('Password:             ', '*'.repeat(password.length));
console.log('ADMIN_PASSWORD_HASH:  ', hash);
console.log('--------------------------------------------------');
console.log('\nAdd this line to your .env file or Railway variables:');
console.log(`ADMIN_PASSWORD_HASH="${hash}"\n`);
