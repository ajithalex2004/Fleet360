const crypto = require('crypto');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const EMAIL = 'alex@exlsolutions.ae';
const PASSWORD = 'Admin@1234';

const p = new PrismaClient();
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(PASSWORD, salt, 100000, 64, 'sha512').toString('hex');
const stored = salt + ':' + hash;

p.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT')
  .then(() => p.$executeRawUnsafe('UPDATE "User" SET password_hash=$1 WHERE email=$2', stored, EMAIL))
  .then(n => { console.log('Done! Rows updated:', Number(n)); p.$disconnect(); })
  .catch(e => { console.error('Error:', e.message); p.$disconnect(); });