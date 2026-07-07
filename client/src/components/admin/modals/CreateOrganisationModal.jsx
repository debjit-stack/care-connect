import React, { useState } from 'react';

// PHASE-B addition. Mirrors AddStaffModal.jsx/AddDoctorModal.jsx's existing
// modal conventions (fixed overlay, white card, Cancel/Save footer) rather
// than inventing a new visual pattern.
//
// The "create first admin now" section is a collapsible sub-form that maps
// directly onto organisationValidators.js's optional `adminUser` field —
// when left collapsed/empty, the request is sent with no `adminUser` key at
// all, and organisationController.createOrganisation creates only the
// organisation (existing two-step onboarding still works exactly as
// before). When filled in, both are created atomically server-side.
const emptyAddress = { line1: '', city: '', state: '', pincode: '', country: 'India' };

const slugify = (value) =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

const CreateOrganisationModal = ({ onClose, onSave }) => {
    const [name, setName]                 = useState('');
    const [slug, setSlug]                 = useState('');
    const [slugTouched, setSlugTouched]   = useState(false);
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [address, setAddress]           = useState(emptyAddress);
    const [plan, setPlan]                 = useState('trial');

    const [includeAdmin, setIncludeAdmin] = useState(false);
    const [adminName, setAdminName]       = useState('');
    const [adminEmail, setAdminEmail]     = useState('');
    const [adminPassword, setAdminPassword] = useState('');

    const [error, setError]     = useState('');
    const [saving, setSaving]   = useState(false);

    const handleNameChange = (e) => {
        const value = e.target.value;
        setName(value);
        // Auto-suggest a slug from the name until the user edits the slug
        // field directly themselves — a small convenience, not a
        // requirement (the field stays fully editable either way).
        if (!slugTouched) setSlug(slugify(value));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (includeAdmin && (!adminName || !adminEmail || !adminPassword)) {
            setError('Please fill in all first-admin fields, or turn off "Create first admin now".');
            return;
        }

        setSaving(true);
        try {
            const payload = {
                name,
                slug,
                contactEmail,
                contactPhone: contactPhone || undefined,
                address,
                plan,
            };

            if (includeAdmin) {
                payload.adminUser = {
                    name:     adminName,
                    email:    adminEmail,
                    password: adminPassword,
                };
            }

            await onSave(payload);
        } catch (err) {
            setError(err?.response?.data?.message || 'Failed to create organisation. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 overflow-y-auto py-8">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-lg">
                <h2 className="text-2xl font-bold mb-6">Create New Organisation</h2>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-1">Hospital Name</label>
                        <input
                            type="text" value={name} onChange={handleNameChange}
                            className="w-full p-2 border rounded" required disabled={saving}
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-1">
                            Slug <span className="font-normal text-gray-400">(used for the org's login subdomain/header)</span>
                        </label>
                        <input
                            type="text"
                            value={slug}
                            onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                            className="w-full p-2 border rounded font-mono text-sm"
                            required
                            disabled={saving}
                            minLength={3}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-1">Contact Email</label>
                            <input
                                type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                                className="w-full p-2 border rounded" required disabled={saving}
                            />
                        </div>
                        <div>
                            <label className="block text-gray-700 text-sm font-bold mb-1">Contact Phone</label>
                            <input
                                type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                                className="w-full p-2 border rounded" disabled={saving}
                            />
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-1">Plan</label>
                        <select
                            value={plan} onChange={(e) => setPlan(e.target.value)}
                            className="w-full p-2 border rounded bg-white" disabled={saving}
                        >
                            <option value="trial">Trial</option>
                            <option value="basic">Basic</option>
                            <option value="pro">Pro</option>
                            <option value="enterprise">Enterprise</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <input placeholder="Address line 1" value={address.line1}
                            onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                            className="col-span-2 p-2 border rounded" disabled={saving} />
                        <input placeholder="City" value={address.city}
                            onChange={(e) => setAddress({ ...address, city: e.target.value })}
                            className="p-2 border rounded" disabled={saving} />
                        <input placeholder="State" value={address.state}
                            onChange={(e) => setAddress({ ...address, state: e.target.value })}
                            className="p-2 border rounded" disabled={saving} />
                        <input placeholder="Pincode" value={address.pincode}
                            onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                            className="p-2 border rounded" disabled={saving} />
                        <input placeholder="Country" value={address.country}
                            onChange={(e) => setAddress({ ...address, country: e.target.value })}
                            className="p-2 border rounded" disabled={saving} />
                    </div>

                    <div className="border-t pt-4 mb-6">
                        <label className="flex items-center gap-2 cursor-pointer mb-3">
                            <input
                                type="checkbox" checked={includeAdmin}
                                onChange={(e) => setIncludeAdmin(e.target.checked)}
                                className="w-4 h-4" disabled={saving}
                            />
                            <span className="font-semibold text-gray-700">Create first admin now</span>
                        </label>

                        {includeAdmin && (
                            <div className="space-y-3 pl-6">
                                <input
                                    placeholder="Admin full name" value={adminName}
                                    onChange={(e) => setAdminName(e.target.value)}
                                    className="w-full p-2 border rounded" disabled={saving}
                                />
                                <input
                                    type="email" placeholder="Admin email" value={adminEmail}
                                    onChange={(e) => setAdminEmail(e.target.value)}
                                    className="w-full p-2 border rounded" disabled={saving}
                                />
                                <input
                                    type="password" placeholder="Temporary password" value={adminPassword}
                                    onChange={(e) => setAdminPassword(e.target.value)}
                                    className="w-full p-2 border rounded" disabled={saving}
                                />
                                <p className="text-xs text-gray-400">
                                    Must be at least 8 characters with an uppercase letter, a number, and a special character.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end space-x-4">
                        <button type="button" onClick={onClose} disabled={saving}
                            className="bg-gray-300 text-gray-800 py-2 px-4 rounded disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="bg-blue-500 text-white py-2 px-4 rounded disabled:opacity-50">
                            {saving ? 'Creating…' : 'Create Organisation'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateOrganisationModal;
