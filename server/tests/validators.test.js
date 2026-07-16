import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    mongoId,
    emailField,
    nameField,
    passwordField,
    isoDate,
    timeHHMM,
    validate,
} from '../validators/shared.js';
import { searchPatientsSchema } from '../validators/receptionistValidators.js';

// ── field-level schema tests ─────────────────────────────────────────────────

describe('shared.js — mongoId', () => {
    test('accepts a valid 24-char hex ObjectId string', () => {
        assert.doesNotThrow(() => mongoId.parse('507f1f77bcf86cd799439011'));
    });
    test('rejects a too-short id', () => {
        assert.throws(() => mongoId.parse('abc123'));
    });
    test('rejects a non-hex id of the right length', () => {
        assert.throws(() => mongoId.parse('zzzzzzzzzzzzzzzzzzzzzzzz'));
    });
});

describe('shared.js — emailField', () => {
    test('lowercases and trims a valid email', () => {
        assert.equal(emailField.parse('  User@Example.COM  '), 'user@example.com');
    });
    test('rejects a malformed email', () => {
        assert.throws(() => emailField.parse('not-an-email'));
    });
});

describe('shared.js — nameField', () => {
    test('accepts names with hyphens, apostrophes, and spaces', () => {
        assert.doesNotThrow(() => nameField.parse("Mary-Jane O'Brien"));
    });
    test('rejects names containing digits or symbols (defends against injection-style payloads in a free-text name field)', () => {
        assert.throws(() => nameField.parse('Robert<script>'));
        assert.throws(() => nameField.parse('User123'));
    });
    test('rejects a single-character name (below the 2-char minimum)', () => {
        assert.throws(() => nameField.parse('A'));
    });
});

describe('shared.js — passwordField', () => {
    test('accepts a password meeting all four rules', () => {
        assert.doesNotThrow(() => passwordField.parse('Str0ng!Pass'));
    });
    test('rejects a password missing an uppercase letter', () => {
        assert.throws(() => passwordField.parse('weak1!pass'));
    });
    test('rejects a password missing a digit', () => {
        assert.throws(() => passwordField.parse('NoDigits!'));
    });
    test('rejects a password missing a special character', () => {
        assert.throws(() => passwordField.parse('NoSpecial1'));
    });
    test('rejects a password under 8 characters', () => {
        assert.throws(() => passwordField.parse('Sh0rt!'));
    });
});

describe('shared.js — isoDate', () => {
    test('accepts a well-formed calendar date', () => {
        assert.doesNotThrow(() => isoDate.parse('2026-07-15'));
    });
    // KNOWN DEFECT (found by this test, not yet fixed): `Date.parse()` silently
    // rolls impossible calendar dates over into the next valid date instead of
    // failing — Date.parse('2026-02-30') resolves to 2026-03-02, so
    // `!isNaN(Date.parse(d))` never catches it. isoDate is used for appointment
    // dates and date-of-birth across the app. Documenting current behavior here
    // rather than silently patching validators/shared.js outside the agreed
    // test-writing scope — see REMAINING_IMPLEMENTATION_PLAN.md Phase A7 notes.
    test('does NOT currently reject an impossible calendar date like Feb 30 (known gap, tracked separately)', () => {
        assert.doesNotThrow(() => isoDate.parse('2026-02-30'));
    });
    test('rejects a non-ISO format', () => {
        assert.throws(() => isoDate.parse('15/07/2026'));
    });
});

describe('shared.js — timeHHMM', () => {
    test('accepts valid 24-hour times', () => {
        assert.doesNotThrow(() => timeHHMM.parse('00:00'));
        assert.doesNotThrow(() => timeHHMM.parse('23:59'));
    });
    test('rejects an out-of-range hour', () => {
        assert.throws(() => timeHHMM.parse('24:00'));
    });
    test('rejects 12-hour format with AM/PM suffix', () => {
        assert.throws(() => timeHHMM.parse('09:00 AM'));
    });
});

// ── validate() middleware ─────────────────────────────────────────────────────

const makeReqRes = ({ body = {}, params = {}, query = {} } = {}) => {
    const req = { body, params, query };
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

describe('shared.js — validate() middleware', () => {
    const schema = searchPatientsSchema;

    test('calls next() and normalizes req.query on valid input', () => {
        const { req, res, next, wasNextCalled } = makeReqRes({ query: { q: 'John' } });
        validate(schema)(req, res, next);
        assert.equal(wasNextCalled(), true);
        assert.equal(req.query.q, 'John');
    });

    test('responds 400 with a field-labeled error array on invalid input, and does not call next()', () => {
        const { req, res, next, getStatus, getJson, wasNextCalled } = makeReqRes({ query: {} });
        validate(schema)(req, res, next);
        assert.equal(wasNextCalled(), false);
        assert.equal(getStatus(), 400);
        assert.equal(getJson().message, 'Validation failed');
        assert.ok(Array.isArray(getJson().errors));
        assert.equal(getJson().errors[0].field, 'q');
    });

    // Security-relevant: q is transformed to escape regex metacharacters before
    // it ever reaches a MongoDB $regex filter, preventing both regex injection
    // and ReDoS via crafted patterns (e.g. catastrophic backtracking payloads).
    test('escapes regex metacharacters in the search query (ReDoS / regex-injection defense)', () => {
        const { req, res, next } = makeReqRes({ query: { q: '.*a+b+$(){}[]|\\^' } });
        validate(schema)(req, res, next);
        // every regex metacharacter should now be backslash-escaped
        assert.equal(req.query.q, '\\.\\*a\\+b\\+\\$\\(\\)\\{\\}\\[\\]\\|\\\\\\^');
    });

    test('rejects an empty search query', () => {
        const { req, res, next, getStatus } = makeReqRes({ query: { q: '' } });
        validate(schema)(req, res, next);
        assert.equal(getStatus(), 400);
    });

    test('rejects a search query over the 100-char limit', () => {
        const { req, res, next, getStatus } = makeReqRes({ query: { q: 'a'.repeat(101) } });
        validate(schema)(req, res, next);
        assert.equal(getStatus(), 400);
    });
});
