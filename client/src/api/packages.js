import API from './index.js';

// Public catalog — used by the public-facing PackagesPage.jsx. Now
// correctly tenant-resolved server-side (PHASE-F: this route moved from
// PUBLIC_NO_TENANT to PUBLIC_WITH_TENANT in tenantMiddleware.js) — no
// change needed here, the same request now just returns correctly scoped
// data.
export const fetchPackages = () => API.get('/packages');

// PHASE-F Task 4 addition: dedicated admin-scoped route, mirroring
// doctors' /admin/doctors-full vs /doctors separation. AdminDashboard.jsx
// now calls this instead of fetchPackages() — see that file.
export const getAdminPackages = () => API.get('/admin/packages-full');

export const createPackage = (packageData) => API.post('/packages', packageData);
export const updatePackage = (id, packageData) => API.put(`/packages/${id}`, packageData);
export const deletePackage = (id) => API.delete(`/packages/${id}`);
