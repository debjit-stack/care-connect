import React, { useRef, useEffect } from 'react';

/**
 * OtpInput
 * ────────
 * Six-digit code entry, shared by RegisterPage, ForgotPasswordPage, and (in
 * spirit) MFAVerifyStep's TOTP box. Extracted here so the paste/backspace/
 * auto-focus/auto-submit behavior lives in one place instead of being
 * copy-pasted across every OTP screen this feature adds.
 *
 * Props:
 *   value        — array of 6 strings, e.g. ['1','2','3','4','5','6']
 *   onChange     — (nextValueArray) => void
 *   onComplete   — () => void, called once when all 6 digits are filled
 *   disabled     — boolean
 *   autoFocus    — boolean, focuses the first box on mount (default true)
 */
const OtpInput = ({ value, onChange, onComplete, disabled = false, autoFocus = true }) => {
    const inputRefs = useRef([]);

    useEffect(() => {
        if (autoFocus) inputRefs.current[0]?.focus();
    }, [autoFocus]);

    const handleChange = (index, raw) => {
        if (raw.length > 1) {
            const cleaned = raw.replace(/\D/g, '').slice(0, 6);
            if (cleaned.length === 6) {
                const next = cleaned.split('');
                onChange(next);
                inputRefs.current[5]?.focus();
                onComplete?.();
                return;
            }
        }

        const digit = raw.replace(/\D/g, '').slice(-1);
        const next  = [...value];
        next[index] = digit;
        onChange(next);

        if (digit && index < 5) inputRefs.current[index + 1]?.focus();
        if (digit && index === 5 && next.every((d) => d)) onComplete?.();
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !value[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    return (
        <div className="flex justify-center gap-2">
            {value.map((digit, i) => (
                <input
                    key={i}
                    ref={(el) => (inputRefs.current[i] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    disabled={disabled}
                    className={`
                        w-11 h-14 text-center text-xl font-bold border-2 rounded-lg
                        focus:outline-none focus:border-blue-500 transition-colors
                        ${digit ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                />
            ))}
        </div>
    );
};

export default OtpInput;
