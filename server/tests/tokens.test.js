import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import '../config/env.js'; // triggers required-env validation as a side effect

import {
    generateAccessToken,
    verifyAccessToken,
    generateMfaPendingToken,
    verifyMfaPendingToken,
    generateResetPendingToken,
    verifyResetPendingToken,
} from '../utils/tokens.js';

describe('tokens.js — access token', () => {
    test('round-trips id, role, and organisationId claims', () => {
        const user = { _id: 'user123', role: 'doctor', organisationId: 'org456' };
        const token = generateAccessToken(user);
        const decoded = verifyAccessToken(token);

        assert.equal(decoded.id, 'user123');
        assert.equal(decoded.role, 'doctor');
        assert.equal(decoded.organisationId, 'org456');
    });

    test('organisationId claim is null when user has no org (e.g. super_admin)', () => {
        const user = { _id: 'sa1', role: 'super_admin', organisationId: null };
        const token = generateAccessToken(user);
        const decoded = verifyAccessToken(token);

        assert.equal(decoded.organisationId, null);
    });

    test('stringifies an ObjectId-like organisationId rather than embedding an object', () => {
        const fakeObjectId = { toString: () => 'objectid-as-string' };
        const user = { _id: 'user1', role: 'admin', organisationId: fakeObjectId };
        const token = generateAccessToken(user);
        const decoded = verifyAccessToken(token);

        assert.equal(decoded.organisationId, 'objectid-as-string');
    });

    test('rejects a token signed with a different secret (tamper/forgery protection)', () => {
        const forged = jwt.sign({ id: 'attacker', role: 'admin' }, 'wrong-secret');
        assert.throws(() => verifyAccessToken(forged), /invalid signature/);
    });

    test('rejects an expired access token', () => {
        const expired = jwt.sign(
            { id: 'user1', role: 'patient' },
            process.env.JWT_SECRET,
            { expiresIn: -10 } // already expired
        );
        assert.throws(() => verifyAccessToken(expired), /jwt expired/);
    });
});

describe('tokens.js — MFA pending token', () => {
    test('round-trips and carries the mfaPending marker', () => {
        const token = generateMfaPendingToken('user1');
        const decoded = verifyMfaPendingToken(token);

        assert.equal(decoded.id, 'user1');
        assert.equal(decoded.mfaPending, true);
    });

    test('rejects a well-formed but wrong-purpose token (e.g. reset token) via secret mismatch', () => {
        // Reset tokens are signed with a different secret than MFA-pending tokens,
        // so this should fail verification outright — not just fail the mfaPending flag check.
        const resetToken = generateResetPendingToken('user1');
        assert.throws(() => verifyMfaPendingToken(resetToken));
    });

    test('rejects a token from the same secret family but missing the mfaPending flag', () => {
        const secret = process.env.JWT_MFA_PENDING_SECRET;
        const noFlagToken = jwt.sign({ id: 'user1' }, secret, { expiresIn: '5m' });
        assert.throws(() => verifyMfaPendingToken(noFlagToken), /Not an MFA pending token/);
    });
});

describe('tokens.js — reset pending token', () => {
    test('round-trips and carries the resetPending marker', () => {
        const token = generateResetPendingToken('user1');
        const decoded = verifyResetPendingToken(token);

        assert.equal(decoded.id, 'user1');
        assert.equal(decoded.resetPending, true);
    });

    test('a reset token cannot be used where an MFA-pending token is expected, and vice versa', () => {
        const mfaToken = generateMfaPendingToken('user1');
        assert.throws(() => verifyResetPendingToken(mfaToken));

        const resetToken = generateResetPendingToken('user1');
        assert.throws(() => verifyMfaPendingToken(resetToken));
    });
});
