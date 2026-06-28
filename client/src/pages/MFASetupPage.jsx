import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupMfa, verifyMfaSetup } from '../api/mfa.js';
import { useAuth } from '../context/AuthContext.jsx';

// ── Constants ──────────────────────────────────────────────────────────────────
const SETUP_TTL_SECONDS = 300; // must match server MFA_SETUP_TTL_SECONDS (5 min)

// ── QR Skeleton ────────────────────────────────────────────────────────────────
// Polish item: loading skeleton while QR generates — shows the expected
// 192×192 placeholder so the layout doesn't jump when the image arrives.
const QRSkeleton = () => (
    <div className="flex justify-center mb-4">
        <div className="w-48 h-48 border-2 border-gray-200 rounded-lg bg-gray-100 animate-pulse" />
    </div>
);

// ── Countdown Timer ────────────────────────────────────────────────────────────
// Polish item: 5-minute countdown display driven by the server TTL.
// When it hits 0, the verify button is disabled and a Regenerate prompt appears.
const CountdownTimer = ({ secondsLeft, expired }) => {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    const pad  = (n) => String(n).padStart(2, '0');

    if (expired) {
        return (
            <div className="flex items-center justify-center gap-1 text-red-500 text-sm font-medium">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                QR code expired
            </div>
        );
    }

    const isUrgent = secondsLeft <= 60;
    return (
        <div className={`flex items-center justify-center gap-1 text-sm font-medium ${
            isUrgent ? 'text-red-500' : 'text-gray-400'
        }`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Expires in {pad(mins)}:{pad(secs)}
        </div>
    );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const MFASetupPage = () => {
    const [step,        setStep]        = useState('loading');
    const [qrDataUri,   setQrDataUri]   = useState('');
    const [setupId,     setSetupId]     = useState(null);
    const [secret,      setSecret]      = useState('');
    const [digits,      setDigits]      = useState(['', '', '', '', '', '']);
    const [error,       setError]       = useState('');
    const [loading,     setLoading]     = useState(false);
    const [showSecret,  setShowSecret]  = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(SETUP_TTL_SECONDS);
    const [timerExpired,setTimerExpired]= useState(false);
    const [regenerating,setRegenerating]= useState(false);

    // Polish item: success screen — brief confirmation before dashboard redirect
    const [showSuccess, setShowSuccess] = useState(false);

    const inputRefs  = useRef([]);
    const timerRef   = useRef(null);
    const navigate   = useNavigate();
    const { completeLogin } = useAuth();

    const params     = new URLSearchParams(window.location.search);
    const isRequired = params.get('required') === 'true';
    const mfaPending = params.get('mfaPending');

    // ── Timer ──────────────────────────────────────────────────────────────────
    const startTimer = useCallback((startSeconds = SETUP_TTL_SECONDS) => {
        if (timerRef.current) clearInterval(timerRef.current);
        setSecondsLeft(startSeconds);
        setTimerExpired(false);

        timerRef.current = setInterval(() => {
            setSecondsLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(timerRef.current);
                    setTimerExpired(true);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

    // ── Fetch setup session ────────────────────────────────────────────────────
    const fetchSetup = useCallback(async () => {
        try {
            const { data } = await setupMfa(mfaPending);
            setQrDataUri(data.qrDataUri);
            setSecret(data.secret || '');
            setSetupId(data.setupId);
            setStep('scan');
            // Start countdown using server-reported TTL if available
            startTimer(data.expiresIn ?? SETUP_TTL_SECONDS);
        } catch (err) {
            const msg = err.response?.data?.message || err.message || 'Failed to load MFA setup.';
            if (msg.includes('already enabled')) {
                setStep('done');
            } else {
                setError(msg);
                setStep('scan');
            }
        }
    }, [mfaPending, startTimer]);

    useEffect(() => { fetchSetup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── QR regeneration ────────────────────────────────────────────────────────
    // Polish item: lets the user get a fresh QR + new Redis session without
    // leaving the page — invalids the old setupId automatically (new UUID).
    const handleRegenerate = async () => {
        setRegenerating(true);
        setError('');
        setQrDataUri('');
        setSetupId(null);
        setStep('loading');
        setDigits(['', '', '', '', '', '']);
        setShowSecret(false);
        try {
            await fetchSetup();
        } finally {
            setRegenerating(false);
        }
    };

    // ── Digit input handling ───────────────────────────────────────────────────
    const handleDigitChange = (index, value) => {
        // Handle paste of full 6-digit code
        if (value.length > 1) {
            const cleaned = value.replace(/\D/g, '').slice(0, 6);
            if (cleaned.length === 6) {
                const next = cleaned.split('');
                setDigits(next);
                inputRefs.current[5]?.focus();
                return;
            }
        }

        const digit = value.replace(/\D/g, '').slice(-1);
        const next  = [...digits];
        next[index] = digit;
        setDigits(next);

        if (digit && index < 5) inputRefs.current[index + 1]?.focus();
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    // ── Verify ─────────────────────────────────────────────────────────────────
    const handleVerify = useCallback(async (overrideDigits) => {
        setError('');

        const token = (overrideDigits ?? digits).join('');
        if (token.length !== 6) { setError('Please enter all 6 digits.'); return; }
        if (!setupId)            { setError('Setup session not ready. Please wait a moment.'); return; }
        if (timerExpired)        { setError('Setup session expired. Please regenerate the QR code.'); return; }

        setLoading(true);
        try {
            const { data } = await verifyMfaSetup({ token, setupId }, mfaPending);

            // Polish item: show brief success screen before completing login
            setShowSuccess(true);

            // Complete login after 1.5s so user sees the confirmation
            setTimeout(() => {
                completeLogin(data);

                // Polish item: navigate with replace:true + no query params
                // so the browser Back button does not return to /mfa-setup?mfaPending=...
                navigate('/', { replace: true });
            }, 1500);
        } catch (err) {
            setError(err.response?.data?.message || 'Verification failed. Please try again.');
            setDigits(['', '', '', '', '', '']);
            inputRefs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    }, [digits, setupId, timerExpired, mfaPending, completeLogin, navigate]);

    // ── Auto-submit ────────────────────────────────────────────────────────────
    // Polish item: when all 6 digits are filled, submit automatically.
    // Only triggers when the user types (not on paste — paste triggers directly).
    useEffect(() => {
        if (step === 'verify' && digits.join('').length === 6 && !loading && !timerExpired) {
            handleVerify(digits);
        }
    }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Success screen ─────────────────────────────────────────────────────────
    if (showSuccess) {
        return (
            <div className="max-w-md mx-auto mt-10 text-center">
                <div className="bg-white p-8 rounded-lg shadow-md">
                    <div className="flex justify-center mb-4">
                        <div className="bg-green-100 rounded-full p-4 animate-bounce">
                            <svg className="w-12 h-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-gray-800">MFA Enabled!</h2>
                    <p className="text-gray-500 text-sm mb-2">
                        Your account is now protected with two-factor authentication.
                    </p>
                    <p className="text-gray-400 text-xs">Redirecting to dashboard…</p>
                </div>
            </div>
        );
    }

    // ── Already done screen ────────────────────────────────────────────────────
    if (step === 'done') {
        return (
            <div className="max-w-md mx-auto mt-10 text-center">
                <div className="bg-white p-8 rounded-lg shadow-md">
                    <div className="flex justify-center mb-4">
                        <div className="bg-green-100 rounded-full p-4">
                            <svg className="w-12 h-12 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold mb-2 text-gray-800">MFA Already Enabled</h2>
                    <p className="text-gray-500 mb-6">
                        Your account is already protected with two-factor authentication.
                    </p>
                    <button
                        onClick={() => navigate('/', { replace: true })}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                    >
                        Continue to Dashboard
                    </button>
                </div>
            </div>
        );
    }

    // ── Loading screen ─────────────────────────────────────────────────────────
    if (step === 'loading') {
        return (
            <div className="max-w-lg mx-auto mt-8">
                <div className="bg-white p-8 rounded-lg shadow-md">
                    <div className="text-center mb-6">
                        <div className="flex justify-center mb-3">
                            <div className="bg-blue-100 rounded-full p-3">
                                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                    />
                                </svg>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">Set Up Two-Factor Authentication</h2>
                        <p className="text-gray-400 text-sm mt-2">Generating your QR code…</p>
                    </div>
                    {/* Polish item: skeleton placeholder instead of raw spinner */}
                    <QRSkeleton />
                    <div className="h-4 bg-gray-100 rounded animate-pulse w-48 mx-auto mb-4" />
                    <div className="h-10 bg-gray-100 rounded animate-pulse w-full" />
                </div>
            </div>
        );
    }

    // ── Main setup UI ──────────────────────────────────────────────────────────
    return (
        <div className="max-w-lg mx-auto mt-8">
            <div className="bg-white p-8 rounded-lg shadow-md">
                {/* Header */}
                <div className="text-center mb-6">
                    <div className="flex justify-center mb-3">
                        <div className="bg-blue-100 rounded-full p-3">
                            <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800">Set Up Two-Factor Authentication</h2>
                    {isRequired && (
                        <p className="text-amber-600 text-sm mt-2 bg-amber-50 px-3 py-2 rounded">
                            Your organisation requires MFA to access this system.
                        </p>
                    )}
                </div>

                {/* Step indicator */}
                <div className="flex items-center justify-center mb-4 gap-4">
                    {['Scan QR', 'Verify'].map((label, i) => (
                        <div key={label} className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
                                ${step === 'scan'   && i === 0 ? 'bg-blue-500 text-white'  :
                                  step === 'verify' && i === 1 ? 'bg-blue-500 text-white'  :
                                  step === 'verify' && i === 0 ? 'bg-green-500 text-white' :
                                  'bg-gray-200 text-gray-500'}`}>
                                {step === 'verify' && i === 0 ? '✓' : i + 1}
                            </div>
                            <span className={`text-sm ${
                                (step === 'scan' && i === 0) || (step === 'verify' && i === 1)
                                    ? 'text-blue-600 font-semibold' : 'text-gray-400'
                            }`}>{label}</span>
                            {i === 0 && <span className="text-gray-300">→</span>}
                        </div>
                    ))}
                </div>

                {/* Polish item: countdown timer shown on both scan + verify steps */}
                <div className="mb-4">
                    <CountdownTimer secondsLeft={secondsLeft} expired={timerExpired} />
                </div>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                {/* Polish item: expired state with regenerate button */}
                {timerExpired && (
                    <div className="text-center mb-4">
                        <p className="text-sm text-gray-500 mb-3">
                            Your setup session has expired. Generate a new QR code to continue.
                        </p>
                        <button
                            onClick={handleRegenerate}
                            disabled={regenerating}
                            className="bg-blue-500 hover:bg-blue-700 text-white text-sm font-bold py-2 px-6 rounded disabled:opacity-50 transition-colors"
                        >
                            {regenerating ? 'Generating…' : '↺ Generate New QR Code'}
                        </button>
                    </div>
                )}

                {/* Step 1: Scan */}
                {step === 'scan' && !timerExpired && (
                    <div>
                        <p className="text-gray-600 text-sm mb-4">
                            Scan this QR code with your authenticator app (Google Authenticator, Authy, or any TOTP app).
                        </p>

                        {qrDataUri ? (
                            <div className="flex justify-center mb-2">
                                <img
                                    src={qrDataUri}
                                    alt="MFA QR Code"
                                    className="w-48 h-48 border-2 border-gray-200 rounded-lg"
                                />
                            </div>
                        ) : (
                            <QRSkeleton />
                        )}

                        {/* Regenerate link below QR */}
                        <div className="flex justify-center mb-4">
                            <button
                                type="button"
                                onClick={handleRegenerate}
                                disabled={regenerating}
                                className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                            >
                                {regenerating ? 'Regenerating…' : '↺ Regenerate QR code'}
                            </button>
                        </div>

                        {/* Manual entry fallback */}
                        {secret && (
                            <div className="mb-4">
                                <button
                                    type="button"
                                    onClick={() => setShowSecret(!showSecret)}
                                    className="text-sm text-blue-500 hover:underline w-full text-center"
                                >
                                    {showSecret ? 'Hide manual key' : "Can't scan? Enter code manually"}
                                </button>
                                {showSecret && (
                                    <div className="mt-2 bg-gray-50 border rounded p-3">
                                        <p className="text-xs text-gray-500 mb-1">Manual entry key:</p>
                                        <p className="font-mono text-sm text-gray-800 break-all select-all">{secret}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        <button
                            onClick={() => {
                                if (!setupId) { setError('Setup session not ready. Please wait a moment.'); return; }
                                setStep('verify');
                                setError('');
                                setTimeout(() => inputRefs.current[0]?.focus(), 100);
                            }}
                            disabled={!setupId || regenerating}
                            className="w-full bg-blue-500 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-colors"
                        >
                            {setupId ? "I've scanned it →" : 'Loading…'}
                        </button>

                        {!isRequired && (
                            <button
                                type="button"
                                onClick={() => navigate(-1)}
                                className="w-full text-gray-400 hover:text-gray-600 text-sm py-2 mt-2 transition-colors"
                            >
                                Skip for now
                            </button>
                        )}
                    </div>
                )}

                {/* Step 2: Verify */}
                {step === 'verify' && !timerExpired && (
                    <div>
                        <p className="text-gray-600 text-sm mb-4 text-center">
                            Enter the 6-digit code shown in your authenticator app.
                        </p>

                        {/* Polish item: auto-submit fires via useEffect when 6 digits filled */}
                        <div className="flex justify-center gap-2 mb-2">
                            {digits.map((digit, i) => (
                                <input
                                    key={i}
                                    ref={(el) => (inputRefs.current[i] = el)}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={digit}
                                    onChange={(e) => handleDigitChange(i, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(i, e)}
                                    disabled={loading}
                                    className={`
                                        w-11 h-14 text-center text-xl font-bold border-2 rounded-lg
                                        focus:outline-none focus:border-blue-500 transition-colors
                                        ${digit ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
                                        ${loading ? 'opacity-50' : ''}
                                    `}
                                />
                            ))}
                        </div>

                        {/* Auto-submit hint */}
                        <p className="text-center text-xs text-gray-400 mb-4">
                            Code will submit automatically when all 6 digits are entered.
                        </p>

                        <button
                            type="button"
                            onClick={() => handleVerify()}
                            disabled={loading || digits.join('').length !== 6}
                            className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-2"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                    </svg>
                                    Verifying…
                                </span>
                            ) : 'Enable MFA'}
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                setStep('scan');
                                setDigits(['', '', '', '', '', '']);
                                setError('');
                            }}
                            className="w-full text-gray-400 hover:text-gray-600 text-sm py-1 transition-colors"
                        >
                            ← Back to QR code
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MFASetupPage;
