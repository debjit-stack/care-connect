import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import '../config/env.js';

import { generateStepUpToken, generateMfaPendingToken } from '../utils/tokens.js';
import { requireStepUp } from '../middleware/stepUpMiddleware.js';

const makeReqRes = ({ headers = {}, user = null } = {}) => {
    const req = { headers, user };
    let statusCode = null;
    let jsonBody = null;
    const res = {
        status(code) { statusCode = code; return this; },
        json(payload) { jsonBody = payload; return this; },
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    return { req, res, next, getStatus: () => statusCode, getJson: () => jsonBody, wasNextCalled: () => nextCalled };
};

describe('stepUpMiddleware.js — requireStepUp', () => {
    test('calls next() when a valid, matching step-up token is presented', () => {
        const token = generateStepUpToken('user1');
        const { req, res, next, wasNextCalled } = makeReqRes({
            headers: { 'x-step-up-token': token },
            user: { _id: 'user1' },
        });
        requireStepUp(req, res, next);
        assert.equal(wasNextCalled(), true);
    });

    test('responds 401 with stepUpRequired:true when no token header is present', () => {
        const { req, res, next, getStatus, getJson, wasNextCalled } = makeReqRes({
            user: { _id: 'user1' },
        });
        requireStepUp(req, res, next);
        assert.equal(wasNextCalled(), false);
        assert.equal(getStatus(), 401);
        assert.equal(getJson().stepUpRequired, true);
    });

    test('responds 401 with stepUpRequired:true for an expired/garbage token', () => {
        const { req, res, next, getStatus, getJson, wasNextCalled } = makeReqRes({
            headers: { 'x-step-up-token': 'not-a-real-jwt' },
            user: { _id: 'user1' },
        });
        requireStepUp(req, res, next);
        assert.equal(wasNextCalled(), false);
        assert.equal(getStatus(), 401);
        assert.equal(getJson().stepUpRequired, true);
    });

    test('responds 401 for a well-formed token of the WRONG type (e.g. mfaPending, not step-up)', () => {
        // Different secret family entirely — must fail verification outright,
        // not just fail a "wrong flag" check, since they're signed differently.
        const wrongTypeToken = generateMfaPendingToken('user1');
        const { req, res, next, getStatus, wasNextCalled } = makeReqRes({
            headers: { 'x-step-up-token': wrongTypeToken },
            user: { _id: 'user1' },
        });
        requireStepUp(req, res, next);
        assert.equal(wasNextCalled(), false);
        assert.equal(getStatus(), 401);
    });

    test('responds 403 when the token belongs to a DIFFERENT user than req.user (stolen/replayed token defense)', () => {
        const tokenForSomeoneElse = generateStepUpToken('attacker-user-id');
        const { req, res, next, getStatus, getJson, wasNextCalled } = makeReqRes({
            headers: { 'x-step-up-token': tokenForSomeoneElse },
            user: { _id: 'victim-user-id' },
        });
        requireStepUp(req, res, next);
        assert.equal(wasNextCalled(), false);
        assert.equal(getStatus(), 403);
        assert.equal(getJson().stepUpRequired, true);
    });

    test('responds 403 if req.user is somehow missing even though the token itself is valid (defensive — should never happen given route ordering, but must fail closed)', () => {
        const token = generateStepUpToken('user1');
        const { req, res, next, getStatus, wasNextCalled } = makeReqRes({
            headers: { 'x-step-up-token': token },
            user: null,
        });
        requireStepUp(req, res, next);
        assert.equal(wasNextCalled(), false);
        assert.equal(getStatus(), 403);
    });
});
