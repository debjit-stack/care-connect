# CareConnect Engineering & Design Audit

Date: 2026-02-16

## High-impact flaws

1. **Password re-hashing bug in `User` model**
   - `userSchema.pre('save')` calls `next()` when password is unchanged but does not `return`, so hashing still executes afterward.
   - This can double-hash passwords on profile updates and break logins.

2. **Critical copy/paste contamination in `HealthPackage` model**
   - `server/models/HealthPackage.js` includes unrelated auth controller code after exporting the model.
   - This violates module boundaries and risks accidental behavior drift and maintenance errors.

3. **No centralized async error handling**
   - Most controllers are async but lack `try/catch` or async middleware wrappers.
   - Rejected promises can produce unstable API behavior and inconsistent error responses.

4. **Appointment booking allows overbooking/race conditions**
   - Booking endpoints create appointments directly without transaction/unique constraints/conflict checks.
   - Concurrent requests can reserve the same doctor/time slot.

5. **Authorization + null safety bug in doctor appointment update**
   - `updateAppointment` dereferences `appointment.doctor` before confirming appointment exists.
   - Doctor profile null path is also unchecked, leading to runtime crashes.

6. **Data model inconsistency around specialty field**
   - Code populates `specialty` from `User` even though specialty belongs to `Doctor`.
   - Produces confusing and potentially incomplete API payloads.

7. **Hardcoded frontend API base URL**
   - `client/src/api/index.js` pins production API URL in source.
   - Breaks environment portability, testability, and secure deployment practices.

8. **Inconsistent entry files (`main.jsx` and `index.jsx`)**
   - Duplicate app bootstrap files increase ambiguity and onboarding friction.

9. **Empty `useAuth` hook file indicates architecture drift**
   - `client/src/hooks/useAuth.js` exists but is empty while context exports another hook.
   - Signals dead code and unclear ownership boundaries.

10. **Potential dependency/API mismatch risk**
   - `react-router-dom` is on major v7 while routing code uses v6-style APIs.
   - Build currently passes, but this increases upgrade and runtime compatibility risk.

## Recommendations (priority order)

1. Fix `User` pre-save hook with `return next()` when password unchanged.
2. Remove non-model code from `HealthPackage` model file and re-locate auth logic.
3. Add global async error handler (`express-async-errors` or custom wrapper).
4. Enforce unique doctor/date/time constraints and/or transactional booking checks.
5. Harden `updateAppointment` null checks before authorization comparisons.
6. Align schema/query contracts so `specialty` is always sourced from `Doctor`.
7. Use environment-driven API URL (`import.meta.env.VITE_API_URL`) with fallback.
8. Consolidate frontend entrypoint to a single file.
9. Remove or implement `useAuth.js` consistently.
10. Lock/test router major version compatibility.
