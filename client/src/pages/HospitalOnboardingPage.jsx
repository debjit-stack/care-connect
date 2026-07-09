import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { createOrganisation, checkSlugAvailability } from '../api/organisations.js';
import { setOrgSlug } from '../api/index.js';

// PHASE-C addition, PHASE-D FIX (Task 5): guided, multi-step hospital
// onboarding. Originally built alongside a separate "Quick Create" modal
// in SuperAdminDashboard with an optional first-admin step; that modal has
// since been removed entirely (Task 5) — this guided flow, with a
// MANDATORY first-admin step, is now the only organisation creation
// workflow in the app.

const emptyAddress = { line1: '', city: '', state: '', pincode: '', country: 'India' };

const slugify = (value) =>
    value.toLowerCase().trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

const STEPS = ['Hospital Details', 'First Admin', 'Review', 'Done'];

const StepIndicator = ({ current }) => (
    <div className="flex items-center justify-center mb-8 gap-2">
        {STEPS.map((label, i) => (
            <React.Fragment key={label}>
                <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                        ${i < current ? 'bg-green-500 text-white' :
                          i === current ? 'bg-blue-500 text-white' :
                          'bg-gray-200 text-gray-500'}`}>
                        {i < current ? '✓' : i + 1}
                    </div>
                    <span className={`text-sm hidden sm:inline ${i === current ? 'text-blue-600 font-semibold' : 'text-gray-400'}`}>
                        {label}
                    </span>
                </div>
                {i < STEPS.length - 1 && <span className="text-gray-300">→</span>}
            </React.Fragment>
        ))}
    </div>
);

const HospitalOnboardingPage = () => {
    const navigate = useNavigate();
    const [step, setStep] = useState(0);

    // Step 1: hospital details
    const [name, setName]                 = useState('');
    const [slug, setSlug]                 = useState('');
    const [slugTouched, setSlugTouched]   = useState(false);
    const [slugStatus, setSlugStatus]     = useState('idle'); // idle | checking | available | taken | invalid
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [address, setAddress]           = useState(emptyAddress);
    const [plan, setPlan]                 = useState('trial');

    // Step 2: first admin (mandatory in this flow)
    const [adminName, setAdminName]         = useState('');
    const [adminEmail, setAdminEmail]       = useState('');
    const [adminPassword, setAdminPassword] = useState('');

    const [error, setError]     = useState('');
    const [saving, setSaving]   = useState(false);
    const [result, setResult]   = useState(null); // { organisation, adminUser } on success

    const slugCheckTimer = useRef(null);

    // ── Live slug availability check (debounced) ────────────────────────────
    useEffect(() => {
        if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);

        if (!slug || slug.length < 3) {
            setSlugStatus('idle');
            return;
        }

        setSlugStatus('checking');
        slugCheckTimer.current = setTimeout(async () => {
            try {
                const { data } = await checkSlugAvailability(slug);
                if (data.reason === 'invalid_format') {
                    setSlugStatus('invalid');
                } else {
                    setSlugStatus(data.available ? 'available' : 'taken');
                }
            } catch {
                setSlugStatus('idle'); // fail open — real conflict still caught server-side on submit
            }
        }, 400);

        return () => { if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current); };
    }, [slug]);

    const handleNameChange = (e) => {
        const value = e.target.value;
        setName(value);
        if (!slugTouched) setSlug(slugify(value));
    };

    // ── Step validation ───────────────────────────────────────────────────────
    const step1Valid = name.trim().length >= 2 &&
        slug.length >= 3 &&
        slugStatus === 'available' &&
        /^\S+@\S+\.\S+$/.test(contactEmail);

    const step2Valid = adminName.trim().length >= 2 &&
        /^\S+@\S+\.\S+$/.test(adminEmail) &&
        adminPassword.length >= 8;

    const goNext = () => { setError(''); setStep((s) => s + 1); };
    const goBack = () => { setError(''); setStep((s) => s - 1); };

    // ── Final submit ───────────────────────────────────────────────────────────
    const handleConfirm = async () => {
        setError('');
        setSaving(true);
        try {
            const { data } = await createOrganisation({
                name,
                slug,
                contactEmail,
                contactPhone: contactPhone || undefined,
                address,
                plan,
                adminUser: { name: adminName, email: adminEmail, password: adminPassword },
            });
            setResult(data);
            setStep(3);
        } catch (err) {
            setError(err?.response?.data?.message || 'Failed to create organisation. Please try again.');
            // Deliberately no setStep() here — the user is already on
            // step 2 (Review) when this fires, since that's the only step
            // handleConfirm is ever called from. The error banner renders
            // in place; no navigation is needed.
        } finally {
            setSaving(false);
        }
    };

    // ── Handoff actions from the Done screen ────────────────────────────────
    const handleGoToHospital = () => {
        setOrgSlug(result.organisation.slug);
        navigate('/admin');
    };

    const slugStatusMessage = {
        idle:      null,
        checking:  <span className="text-gray-400">Checking availability…</span>,
        available: <span className="text-green-600">✓ Available</span>,
        taken:     <span className="text-red-500">✗ Already taken</span>,
        invalid:   <span className="text-red-500">✗ Only lowercase letters, numbers, and hyphens (3–63 chars)</span>,
    }[slugStatus];

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold mb-2 text-center">Onboard a New Hospital</h1>
            <p className="text-gray-500 text-center mb-8">
                A guided setup that creates the organisation and its first administrator together.
            </p>

            <StepIndicator current={step} />

            <div className="bg-white p-8 rounded-lg shadow-md">
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                {/* ── Step 1: Hospital Details ─────────────────────────────────── */}
                {step === 0 && (
                    <div>
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-1">Hospital Name</label>
                            <input type="text" value={name} onChange={handleNameChange}
                                className="w-full p-2 border rounded" autoFocus />
                        </div>

                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-1">Slug</label>
                            <input
                                type="text" value={slug}
                                onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                                className="w-full p-2 border rounded font-mono text-sm"
                            />
                            <div className="text-xs mt-1 h-4">{slugStatusMessage}</div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-1">Contact Email</label>
                                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                                    className="w-full p-2 border rounded" />
                            </div>
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-1">Contact Phone</label>
                                <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                                    className="w-full p-2 border rounded" />
                            </div>
                        </div>

                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-1">Plan</label>
                            <select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full p-2 border rounded bg-white">
                                <option value="trial">Trial</option>
                                <option value="basic">Basic</option>
                                <option value="pro">Pro</option>
                                <option value="enterprise">Enterprise</option>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mb-6">
                            <input placeholder="Address line 1" value={address.line1}
                                onChange={(e) => setAddress({ ...address, line1: e.target.value })}
                                className="col-span-2 p-2 border rounded" />
                            <input placeholder="City" value={address.city}
                                onChange={(e) => setAddress({ ...address, city: e.target.value })}
                                className="p-2 border rounded" />
                            <input placeholder="State" value={address.state}
                                onChange={(e) => setAddress({ ...address, state: e.target.value })}
                                className="p-2 border rounded" />
                            <input placeholder="Pincode" value={address.pincode}
                                onChange={(e) => setAddress({ ...address, pincode: e.target.value })}
                                className="p-2 border rounded" />
                            <input placeholder="Country" value={address.country}
                                onChange={(e) => setAddress({ ...address, country: e.target.value })}
                                className="p-2 border rounded" />
                        </div>

                        <div className="flex justify-between">
                            <button onClick={() => navigate('/super-admin')} className="text-gray-500 hover:text-gray-700 text-sm">
                                ← Cancel
                            </button>
                            <button onClick={goNext} disabled={!step1Valid}
                                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded disabled:opacity-40 disabled:cursor-not-allowed">
                                Next: First Admin →
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 2: First Admin ──────────────────────────────────────── */}
                {step === 1 && (
                    <div>
                        <p className="text-gray-500 text-sm mb-4">
                            This person will be able to manage staff, doctors, and settings for <strong>{name}</strong>.
                        </p>

                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-1">Full Name</label>
                            <input type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)}
                                className="w-full p-2 border rounded" autoFocus />
                        </div>
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-1">Email</label>
                            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
                                className="w-full p-2 border rounded" />
                        </div>
                        <div className="mb-6">
                            <label className="block text-gray-700 text-sm font-bold mb-1">Temporary Password</label>
                            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
                                className="w-full p-2 border rounded" />
                            <p className="text-xs text-gray-400 mt-1">
                                At least 8 characters, with an uppercase letter, a number, and a special character.
                            </p>
                        </div>

                        <div className="flex justify-between">
                            <button onClick={goBack} className="bg-gray-300 text-gray-800 py-2 px-4 rounded">← Back</button>
                            <button onClick={goNext} disabled={!step2Valid}
                                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded disabled:opacity-40 disabled:cursor-not-allowed">
                                Next: Review →
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 3: Review ───────────────────────────────────────────── */}
                {step === 2 && (
                    <div>
                        <h3 className="font-semibold text-lg mb-3">Hospital</h3>
                        <dl className="grid grid-cols-2 gap-y-1 text-sm mb-6">
                            <dt className="text-gray-500">Name</dt><dd>{name}</dd>
                            <dt className="text-gray-500">Slug</dt><dd className="font-mono">{slug}</dd>
                            <dt className="text-gray-500">Contact</dt><dd>{contactEmail}</dd>
                            <dt className="text-gray-500">Plan</dt><dd className="capitalize">{plan}</dd>
                        </dl>

                        <h3 className="font-semibold text-lg mb-3">First Admin</h3>
                        <dl className="grid grid-cols-2 gap-y-1 text-sm mb-6">
                            <dt className="text-gray-500">Name</dt><dd>{adminName}</dd>
                            <dt className="text-gray-500">Email</dt><dd>{adminEmail}</dd>
                        </dl>

                        <div className="flex justify-between">
                            <button onClick={goBack} disabled={saving} className="bg-gray-300 text-gray-800 py-2 px-4 rounded disabled:opacity-50">← Back</button>
                            <button onClick={handleConfirm} disabled={saving}
                                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded disabled:opacity-50">
                                {saving ? 'Creating Hospital…' : 'Confirm & Create Hospital'}
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 4: Done ─────────────────────────────────────────────── */}
                {step === 3 && result && (
                    <div className="text-center">
                        <div className="flex justify-center mb-4">
                            <div className="bg-green-100 rounded-full p-4">
                                <svg className="w-12 h-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold mb-2">{result.organisation.name} is ready</h2>
                        <p className="text-gray-500 mb-6">
                            {result.adminUser?.email} can now sign in as the hospital's admin.
                        </p>
                        <div className="flex flex-col gap-3">
                            <button onClick={handleGoToHospital}
                                className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2.5 px-4 rounded transition-colors">
                                Go to {result.organisation.name}'s Admin Dashboard →
                            </button>
                            <button onClick={() => navigate('/super-admin')}
                                className="text-gray-500 hover:text-gray-700 text-sm py-1">
                                ← Back to Super Admin Overview
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HospitalOnboardingPage;
