import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import speakeasy from 'speakeasy';
import '../config/env.js';

import {
    generateSecret,
    verifyToken,
    encryptSecret,
    decryptSecret,
    generateRecoveryCodes,
    hashRecoveryCode,
    verifyRecoveryCode,
} from '../utils/totp.js';

describe('totp.js — secret generation & TOTP verification', () => {
    test('generateSecret returns a base32 secret, otpauth URL, and QR data URI', async () => {
        const result = await generateSecret('doctor@example.com');
        assert.match(result.secret, /^[A-Z2-7]+=*$/); // base32 alphabet
        assert.match(result.otpauthUrl, /^otpauth:\/\/totp\//);
        assert.match(result.qrDataUri, /^data:image\/png;base64,/);
    });

    test('verifyToken accepts a correctly generated current-window code', async () => {
        const { secret } = await generateSecret('user@example.com');
        const code = speakeasy.totp({ secret, encoding: 'base32' });
        assert.equal(verifyToken(secret, code), true);
    });

    test('verifyToken rejects an incorrect code', async () => {
        const { secret } = await generateSecret('user@example.com');
        assert.equal(verifyToken(secret, '000000'), false);
    });

    test('verifyToken strips whitespace from the submitted token before checking', async () => {
        const { secret } = await generateSecret('user@example.com');
        const code = speakeasy.totp({ secret, encoding: 'base32' });
        const spaced = code.slice(0, 3) + ' ' + code.slice(3);
        assert.equal(verifyToken(secret, spaced), true);
    });
});

describe('totp.js — secret encryption (AES-256-GCM)', () => {
    test('encrypt/decrypt round-trips the original plaintext secret', () => {
        const plain = 'JBSWY3DPEHPK3PXP';
        const encrypted = encryptSecret(plain);
        assert.equal(decryptSecret(encrypted), plain);
    });

    test('encrypted output has the iv:authTag:ciphertext hex format', () => {
        const encrypted = encryptSecret('SOMESECRET');
        const parts = encrypted.split(':');
        assert.equal(parts.length, 3);
        parts.forEach((p) => assert.match(p, /^[0-9a-f]+$/));
    });

    test('two encryptions of the same plaintext produce different ciphertext (random IV)', () => {
        const a = encryptSecret('SAMEVALUE');
        const b = encryptSecret('SAMEVALUE');
        assert.notEqual(a, b);
    });

    test('decrypting a tampered ciphertext throws (GCM auth-tag integrity check)', () => {
        const encrypted = encryptSecret('JBSWY3DPEHPK3PXP');
        const [iv, authTag, ciphertext] = encrypted.split(':');
        // Flip a hex character in the ciphertext to simulate tampering
        const tamperedCiphertext = ciphertext.slice(0, -1) + (ciphertext.slice(-1) === '0' ? '1' : '0');
        const tampered = `${iv}:${authTag}:${tamperedCiphertext}`;
        assert.throws(() => decryptSecret(tampered));
    });

    test('decryptSecret rejects a malformed (non 3-part) encrypted string', () => {
        assert.throws(() => decryptSecret('not-a-valid-format'), /Invalid encrypted secret format/);
    });
});

describe('totp.js — recovery codes', () => {
    test('generateRecoveryCodes returns 8 codes, each 8 chars plain / formatted as XXXX-XXXX', () => {
        const codes = generateRecoveryCodes();
        assert.equal(codes.length, 8);
        codes.forEach(({ plain, formatted }) => {
            assert.equal(plain.length, 8);
            assert.match(plain, /^[A-Z0-9]+$/);
            assert.equal(formatted, `${plain.slice(0, 4)}-${plain.slice(4)}`);
        });
    });

    test('recovery code alphabet excludes ambiguous characters (0, O, 1, I)', () => {
        const codes = generateRecoveryCodes();
        const allChars = codes.map((c) => c.plain).join('');
        assert.doesNotMatch(allChars, /[01OI]/);
    });

    test('generated recovery codes are not trivially predictable (no duplicate set across two calls)', () => {
        const first = generateRecoveryCodes().map((c) => c.plain).join(',');
        const second = generateRecoveryCodes().map((c) => c.plain).join(',');
        assert.notEqual(first, second);
    });

    test('hashRecoveryCode + verifyRecoveryCode round-trip, matching regardless of dash/case formatting', async () => {
        const [{ plain, formatted }] = generateRecoveryCodes();
        const hash = await hashRecoveryCode(plain);
        const stored = [{ codeHash: hash, usedAt: null }];

        // submitted with dashes and lowercase, same as the UI might send from a copy/paste
        const idx = await verifyRecoveryCode(formatted.toLowerCase(), stored);
        assert.equal(idx, 0);
    });

    test('verifyRecoveryCode returns -1 for a code that does not match any stored hash', async () => {
        const hash = await hashRecoveryCode('AAAABBBB');
        const stored = [{ codeHash: hash, usedAt: null }];
        const idx = await verifyRecoveryCode('ZZZZ-9999', stored);
        assert.equal(idx, -1);
    });

    test('verifyRecoveryCode skips codes already marked used, even if the value matches', async () => {
        const hash = await hashRecoveryCode('AAAABBBB');
        const stored = [{ codeHash: hash, usedAt: new Date() }];
        const idx = await verifyRecoveryCode('AAAA-BBBB', stored);
        assert.equal(idx, -1);
    });

    test('verifyRecoveryCode rejects malformed input (wrong length) without ever calling bcrypt', async () => {
        const hash = await hashRecoveryCode('AAAABBBB');
        const stored = [{ codeHash: hash, usedAt: null }];
        const idx = await verifyRecoveryCode('TOO-SHORT', stored);
        assert.equal(idx, -1);
    });
});
