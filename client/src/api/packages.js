import API from './index.js';

export const fetchPackages = () => API.get('/packages');
export const createPackage = (packageData) => API.post('/packages', packageData);
export const updatePackage = (id, packageData) => API.put(`/packages/${id}`, packageData);
export const deletePackage = (id) => API.delete(`/packages/${id}`);