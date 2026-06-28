
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupMfa, verifyMfaSetup } from '../api/mfa.js';
import { useAuth } from '../context/AuthContext.jsx';
    

/**
 * MFASetupPage
 * ─────────────
 * Accessible at /mfa-setup.
 * Used in two scenarios:
 *   1. User voluntarily enables MFA from their settings
 *   2. Org-level mfaRequired=true forces user to set up before accessing dashboard
 *
 * Query param: ?required=true — hides the "Skip" option when org enforces MFA
 * Query param: ?mfaPending=<token> — mfaPending JWT passed from forced-setup login flow
 */
const MFASetupPage = () => {
    const [step,      setStep]      = useState('loading'); // loading | scan | verify | done
    const [qrDataUri, setQrDataUri] = useState('');
    const [setupId, setSetupId] = useState('');
    const [secret,    setSecret]    = useState('');
    const [otpUrl,    setOtpUrl]    = useState('');
    const [digits,    setDigits]    = useState(['', '', '', '', '', '']);
    const [error,     setError]     = useState('');
    const [loading,   setLoading]   = useState(false);
    const [showSecret, setShowSecret] = useState(false);
    const inputRefs = useRef([]);
    const navigate  = useNavigate();
    const { updateUser, completeLogin } = useAuth();

    const params = new URLSearchParams(window.location.search);
    const isRequired = params.get("required") === "true";
    const mfaPending = params.get("mfaPending");

    useEffect(() => {
        const fetchSetup = async () => {
            try {
                console.log("Loading MFA setup...");
                console.log("mfaPending:", mfaPending);

                const { data } = await setupMfa(mfaPending);

                console.log("Setup response:", data);

                setQrDataUri(data.qrDataUri);
                setSecret(data.secret || "");
                setOtpUrl(data.otpauthUrl || "");
                setSetupId(data.setupId);

                setStep("scan");
            } catch (err) {
                console.error("Setup Error:", err);
                console.error("Response:", err.response);

                const msg =
                    err.response?.data?.message ||
                    err.message ||
                    "Failed to load MFA setup. Please try again.";

                if (msg.includes("already enabled")) {
                    setStep("done");
                } else {
                    setError(msg);
                    setStep("scan");
                }
            }
        };

        fetchSetup();
    }, []);

    const handleDigitChange = (index, value) => {
        if (value.length > 1) {
            const cleaned = value.replace(/\D/g, "").slice(0, 6);

            if (cleaned.length === 6) {
                setDigits(cleaned.split(""));
                inputRefs.current[5]?.focus();
                return;
            }
        }

        const digit = value.replace(/\D/g, "").slice(-1);

        const next = [...digits];
        next[index] = digit;
        setDigits(next);

        if (digit && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === "Backspace" && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();

        setError("");

        const token = digits.join("");

        if (token.length !== 6) {
            setError("Please enter all 6 digits.");
            return;
        }

        setLoading(true);

        try {
            const { data } = await verifyMfaSetup(
                {
                    token,
                    setupId,
                },
                mfaPending
            );

            localStorage.setItem("accessToken", data.accessToken);

            completeLogin(data);

            navigate("/");
        } catch (err) {
            console.error(err.response?.data);

            setError(
                err.response?.data?.message ||
                "Verification failed."
            );

            setDigits(["", "", "", "", "", ""]);
            inputRefs.current[0]?.focus();
        } finally {
            setLoading(false);
        }
    };
    const handleDone = () => navigate('/');

    if (step === 'loading') {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
            </div>
        );
    }

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
                    <h2 className="text-2xl font-bold mb-2 text-gray-800">MFA Enabled</h2>
                    <p className="text-gray-500 mb-6">
                        Your account is now protected with two-factor authentication.
                        You'll be asked for a code on each login.
                    </p>
                    <button
                        onClick={handleDone}
                        className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                    >
                        Continue to Dashboard
                    </button>
                </div>
            </div>
        );
    }

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
                <div className="flex items-center justify-center mb-6 gap-4">
                    {['Scan QR', 'Verify'].map((label, i) => (
                        <div key={label} className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
                                ${step === 'scan' && i === 0 ? 'bg-blue-500 text-white' :
                                  step === 'verify' && i === 1 ? 'bg-blue-500 text-white' :
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

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4 text-sm">
                        {error}
                    </div>
                )}

                {/* Step 1: Scan QR */}
                {step === 'scan' && (
                    <div>
                        <p className="text-gray-600 text-sm mb-4">
                            Scan this QR code with your authenticator app (Google Authenticator, Authy, or any TOTP app).
                        </p>

                        {qrDataUri && (
                            <div className="flex justify-center mb-4">
                                <img
                                    src={qrDataUri}
                                    alt="MFA QR Code"
                                    className="w-48 h-48 border-2 border-gray-200 rounded-lg"
                                />
                            </div>
                        )}

                        {/* Manual entry fallback */}
                        <div className="mb-4">
                            <button
                                type="button"
                                onClick={() => setShowSecret(!showSecret)}
                                className="text-sm text-blue-500 hover:underline w-full text-center"
                            >
                                {showSecret ? 'Hide' : "Can't scan? Enter code manually"}
                            </button>
                            {showSecret && (
                                <div className="mt-2 bg-gray-50 border rounded p-3">
                                    <p className="text-xs text-gray-500 mb-1">Manual entry key:</p>
                                    <p className="font-mono text-sm text-gray-800 break-all select-all">{secret}</p>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => { setStep('verify'); setError(''); setTimeout(() => inputRefs.current[0]?.focus(), 100); }}
                            className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                        >
                            I've scanned it →
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
                {step === 'verify' && (
                    <form onSubmit={handleVerify}>
                        <p className="text-gray-600 text-sm mb-4 text-center">
                            Enter the 6-digit code shown in your authenticator app to confirm setup.
                        </p>

                        <div className="flex justify-center gap-2 mb-6">
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
                                    `}
                                />
                            ))}
                        </div>

                        <button
                            type="submit"
                            disabled={loading || digits.join('').length !== 6}
                            className="w-full bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors mb-2"
                        >
                            {loading ? 'Verifying…' : 'Enable MFA'}
                        </button>

                        <button
                            type="button"
                            onClick={() => { setStep('scan'); setDigits(['', '', '', '', '', '']); setError(''); }}
                            className="w-full text-gray-400 hover:text-gray-600 text-sm py-1 transition-colors"
                        >
                            ← Back to QR code
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default MFASetupPage;
