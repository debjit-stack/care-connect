import API from './index.js';

// PHASE-A addition: client/src/api/ previously had no wrapper file for the
// organisations endpoint family at all (admin.js, auth.js, doctors.js,
// packages.js, patient.js, receptionist.js, notifications.js all existed —
// this one didn't), even though the backend endpoints themselves were
// fully built out through Phase 4. Follows the exact same thin-wrapper
// convention as every other file in this directory.

// ── Super-admin: platform + organisation management ───────────────────────────
export const getAllOrganisations = () => API.get('/organisations');
export const getOrganisationById = (id) => API.get(`/organisations/${id}`);
export const createOrganisation  = (data) => API.post('/organisations', data);
export const updateOrganisation  = (id, data) => API.put(`/organisations/${id}`, data);

// Suspend uses the underlying DELETE (soft-delete/deactivate — see
// organisationController.deleteOrganisation) — named `suspendOrganisation`
// here rather than `deleteOrganisation` so calling UI code reads naturally
// ("suspend this hospital") without implying permanent/destructive deletion,
// which this operation is not.
export const suspendOrganisation    = (id) => API.delete(`/organisations/${id}`);
export const reactivateOrganisation = (id) => API.patch(`/organisations/${id}/reactivate`);

export const getOrganisationStats = (id) => API.get(`/organisations/${id}/stats`);
export const getPlatformStats     = () => API.get('/organisations/platform-stats');

// PHASE-C addition: live slug-availability checking for the guided
// onboarding flow (HospitalOnboardingPage.jsx).
export const checkSlugAvailability = (slug) => API.get(`/organisations/slug-availability/${encodeURIComponent(slug)}`);
