import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupMfa, verifyMfaSetup } from '../api/mfa.js';
import { useAuth } from '../context/AuthContext.jsx';

const SETUP_TTL_SECONDS = 300;

// ── QR Skeleton ────────────────────────────────────────────────────────────────
const QRSkeleton = () => (
    <div className="flex justify-center mb-4">
        <div className="w-48 h-48 border-2 border-gray-200 rounded-lg bg-gray-100 animate-pulse" />
    </div>
);

// ── Countdown Timer ────────────────────────────────────────────────────────────
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
        <div className={`flex items-center justify-center gap-1 text-sm font-medium ${isUrgent ? 'text-red-500' : 'text-gray-400'}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Expires in {pad(mins)}:{pad(secs)}
        </div>
    );
};

// ── P3C: Recovery Codes Display ────────────────────────────────────────────────
// Shown exactly once after MFA is enabled. User must acknowledge before continuing.
const RecoveryCodesDisplay = ({ codes, onContinue }) => {
    const [copied,       setCopied]       = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    const allCodesText = codes.join('\n');

    const handleCopyAll = async () => {
        try {
            await navigator.clipboard.writeText(allCodesText);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            // Fallback for browsers without clipboard API
            const el = document.createElement('textarea');
            el.value = allCodesText;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        }
    };

    const handleDownload = () => {
        const content = `CareConnect MFA Recovery Codes\nGenerated: ${new Date().toLocaleString()}\n\nKeep these codes safe. Each code can only be used once.\n\n${allCodesText}\n`;
        const blob    = new Blob([content], { type: 'text/plain' });
        const url     = URL.createObjectURL(blob);
        const link    = document.createElement('a');
        link.href     = url;
        link.download = 'careconnect-recovery-codes.txt';
        link.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-lg mx-auto mt-8">
            <div className="bg-white p-8 rounded-lg shadow-md">
                {/* Header */}
                <div className="text-center mb-6">
                    <div className="flex justify-center mb-3">
                        <div className="bg-green-100 rounded-full p-3">
                            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-800">MFA Enabled!</h2>
                    <p className="text-gray-500 text-sm mt-1">Save your recovery codes before continuing.</p>
                </div>

                {/* Warning banner */}
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-5">
                    <div className="flex gap-3">
                        <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                            <p className="text-sm font-semibold text-amber-800">These codes will not be shown again.</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                                Each code can only be used once. Store them in a secure place — a password manager, encrypted notes, or printed and locked away.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Recovery codes grid */}
                <div className="bg-gray-900 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 gap-2">
                        {codes.map((code, i) => (
                            <div key={i} className="bg-gray-800 rounded px-3 py-2 text-center">
                                <span className="font-mono text-sm text-green-400 tracking-wider">{code}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 mb-5">
                    <button
                        onClick={handleCopyAll}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded font-medium text-sm transition-colors ${
                            copied
                                ? 'bg-green-100 text-green-700 border border-green-300'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        }`}
                    >
                        {copied ? (
                            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>Copied!</>
                        ) : (
                            <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copy All</>
                        )}
                    </button>
                    <button
                        onClick={handleDownload}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium text-sm transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                        </svg>
                        Download .txt
                    </button>
                </div>

                {/* Acknowledgement */}
                <label className="flex items-start gap-3 cursor-pointer mb-5">
                    <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-blue-500"
                    />
                    <span className="text-sm text-gray-600">
                        I have saved my recovery codes in a secure location.
                    </span>
                </label>

                <button
                    onClick={onContinue}
                    disabled={!acknowledged}
                    className="w-full bg-blue-500 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-2.5 px-4 rounded transition-colors"
                >
                    Continue to Dashboard
                </button>
            </div>
        </div>
    );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const MFASetupPage = () => {
    const [step,         setStep]         = useState('loading');
    const [qrDataUri,    setQrDataUri]    = useState('');
    const [setupId,      setSetupId]      = useState(null);
    const [secret,       setSecret]       = useState('');
    const [digits,       setDigits]       = useState(['', '', '', '', '', '']);
    const [error,        setError]        = useState('');
    const [loading,      setLoading]      = useState(false);
    const [showSecret,   setShowSecret]   = useState(false);
    const [secondsLeft,  setSecondsLeft]  = useState(SETUP_TTL_SECONDS);
    const [timerExpired, setTimerExpired] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    // P3C: recovery codes returned by verifySetup
    const [recoveryCodes, setRecoveryCodes] = useState([]);

    // C4 FIX: the pending login payload (which contains the access token)
    // used to be round-tripped through sessionStorage between the "verify"
    // step and the "codes acknowledged" step. sessionStorage is readable by
    // any script on the page, so an XSS during the recovery-codes screen
    // could exfiltrate a live access token — a direct violation of this
    // project's in-memory-only token strategy. It's now held purely in a
    // ref, which never leaves JS memory and is cleared once consumed.
    const pendingLoginDataRef = useRef(null);

    const inputRefs = useRef([]);
    const timerRef  = useRef(null);
    const navigate  = useNavigate();
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
            startTimer(data.expiresIn ?? SETUP_TTL_SECONDS);
        } catch (err) {
            const msg = err.response?.data?.message || 'Failed to load MFA setup.';
            if (msg.includes('already enabled')) {
                setStep('done');
            } else {
                setError(msg);
                setStep('scan');
            }
        }
    }, [mfaPending, startTimer]);

    useEffect(() => { fetchSetup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── QR Regeneration ────────────────────────────────────────────────────────
    const handleRegenerate = async () => {
        setRegenerating(true);
        setError('');
        setQrDataUri('');
        setSetupId(null);
        setStep('loading');
        setDigits(['', '', '', '', '', '']);
        setShowSecret(false);
        try { await fetchSetup(); } finally { setRegenerating(false); }
    };

    // ── Digit input ────────────────────────────────────────────────────────────
    const handleDigitChange = (index, value) => {
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
        if (token.length !== 6)   { setError('Please enter all 6 digits.'); return; }
        if (!setupId)              { setError('Setup session not ready.'); return; }
        if (timerExpired)          { setError('Setup session expired. Please regenerate the QR code.'); return; }

        setLoading(true);
        try {
            const { data } = await verifyMfaSetup({ token, setupId }, mfaPending);

            // P3C: If server returned recovery codes, show them before completing login
            if (data.recoveryCodes?.length) {
                setRecoveryCodes(data.recoveryCodes);
                // C4 FIX: keep the login payload in memory only (ref), not sessionStorage.
                pendingLoginDataRef.current = data;
                setStep('codes');
            } else {
                // No codes (shouldn't happen in normal flow) — complete login immediately
                completeLogin(data);
                navigate('/', { replace: true });
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Verification failed. Please try again.';
            // Handle rate limiting from P3B
            if (err.response?.status === 429) {
                setError(msg);
            } else {
                setError(msg);
                setDigits(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            }
        } finally {
            setLoading(false);
        }
    }, [digits, setupId, timerExpired, mfaPending, completeLogin, navigate]);

    // ── Auto-submit ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (step === 'verify' && digits.join('').length === 6 && !loading && !timerExpired) {
            handleVerify(digits);
        }
    }, [digits]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── P3C: Recovery codes acknowledged — complete login ─────────────────────
    const handleCodesAcknowledged = () => {
        // C4 FIX: read from the in-memory ref instead of sessionStorage, then
        // clear it immediately so the token payload doesn't linger anywhere.
        const loginData = pendingLoginDataRef.current;
        pendingLoginDataRef.current = null;
        if (loginData) completeLogin(loginData);
        navigate('/', { replace: true });
    };

    // ── P3C: Recovery codes step ───────────────────────────────────────────────
    if (step === 'codes') {
        return (
            <RecoveryCodesDisplay
                codes={recoveryCodes}
                onContinue={handleCodesAcknowledged}
            />
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
                    <p className="text-gray-500 mb-6">Your account is already protected with two-factor authentication.</p>
                    <button onClick={() => navigate('/', { replace: true })} className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors">
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
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-gray-800">Set Up Two-Factor Authentication</h2>
                        <p className="text-gray-400 text-sm mt-2">Generating your QR code…</p>
                    </div>
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
                <div className="text-center mb-6">
                    <div className="flex justify-center mb-3">
                        <div className="bg-blue-100 rounded-full p-3">
                            <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
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

                <div className="mb-4">
                    <CountdownTimer secondsLeft={secondsLeft} expired={timerExpired} />
                </div>

                {error && (
                    <div className={`p-3 rounded mb-4 text-sm ${
                        error.includes('Too many')
                            ? 'bg-orange-50 border border-orange-200 text-orange-700'
                            : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                        {error}
                    </div>
                )}

                {timerExpired && (
                    <div className="text-center mb-4">
                        <p className="text-sm text-gray-500 mb-3">Your setup session has expired.</p>
                        <button onClick={handleRegenerate} disabled={regenerating} className="bg-blue-500 hover:bg-blue-700 text-white text-sm font-bold py-2 px-6 rounded disabled:opacity-50 transition-colors">
                            {regenerating ? 'Generating…' : '↺ Generate New QR Code'}
                        </button>
                    </div>
                )}

                {step === 'scan' && !timerExpired && (
                    <div>
                        <p className="text-gray-600 text-sm mb-4">
                            Scan this QR code with your authenticator app (Google Authenticator, Authy, or any TOTP app).
                        </p>
                        {qrDataUri ? (
                            <div className="flex justify-center mb-2">
                                <img src={qrDataUri} alt="MFA QR Code" className="w-48 h-48 border-2 border-gray-200 rounded-lg" />
                            </div>
                        ) : <QRSkeleton />}

                        <div className="flex justify-center mb-4">
                            <button type="button" onClick={handleRegenerate} disabled={regenerating} className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">
                                {regenerating ? 'Regenerating…' : '↺ Regenerate QR code'}
                            </button>
                        </div>

                        {secret && (
                            <div className="mb-4">
                                <button type="button" onClick={() => setShowSecret(!showSecret)} className="text-sm text-blue-500 hover:underline w-full text-center">
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

                        <button onClick={() => { if (!setupId) { setError('Session not ready.'); return; } setStep('verify'); setError(''); setTimeout(() => inputRefs.current[0]?.focus(), 100); }} disabled={!setupId || regenerating} className="w-full bg-blue-500 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded transition-colors">
                            {setupId ? "I've scanned it →" : 'Loading…'}
                        </button>

                        {!isRequired && (
                            <button type="button" onClick={() => navigate(-1)} className="w-full text-gray-400 hover:text-gray-600 text-sm py-2 mt-2 transition-colors">
                                Skip for now
                            </button>
                        )}
                    </div>
                )}

                {step === 'verify' && !timerExpired && (
                    <div>
                        <p className="text-gray-600 text-sm mb-4 text-center">Enter the 6-digit code from your authenticator app.</p>

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
                                    className={`w-11 h-14 text-center text-xl font-bold border-2 rounded-lg focus:outline-none focus:border-blue-500 transition-colors ${digit ? 'border-blue-400 bg-blue-50' : 'border-gray-300'} ${loading ? 'opacity-50' : ''}`}
                                />
                            ))}
                        </div>

                        <p className="text-center text-xs text-gray-400 mb-4">Code submits automatically when all 6 digits are entered.</p>

                        <button type="button" onClick={() => handleVerify()} disabled={loading || digits.join('').length !== 6} className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-2">
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                    Verifying…
                                </span>
                            ) : 'Enable MFA'}
                        </button>

                        <button type="button" onClick={() => { setStep('scan'); setDigits(['', '', '', '', '', '']); setError(''); }} className="w-full text-gray-400 hover:text-gray-600 text-sm py-1 transition-colors">
                            ← Back to QR code
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MFASetupPage;
