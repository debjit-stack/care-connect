import React, { useRef, useEffect } from 'react';

/**
 * OtpInput
 * ────────
 * Six-digit code entry, shared by RegisterPage and ForgotPasswordPage.
 *
 * NEW-C2 FIX: `onComplete` now receives the completed digit array as its
 * argument — e.g. `onComplete(['1','2','3','4','5','6'])`. Previously it was
 * called with no arguments, and callers wired it as `() => handleVerify()`,
 * where `handleVerify` read `digits` from the PARENT's React state via
 * closure. Because `onComplete` fired synchronously inside the same
 * onChange/paste handler that calls `onChange(next)`, the parent's state
 * update hadn't committed/re-rendered yet — so `handleVerify` ran against
 * the previous (5-digit) value and silently no-opped on its length check.
 * Auto-submit looked broken even though the manual "Verify" button worked
 * fine (it reads state at click time, after render). Passing the array
 * directly removes the dependency on stale closures entirely.
 *
 * Props:
 *   value        — array of 6 strings, e.g. ['1','2','3','4','5','6']
 *   onChange     — (nextValueArray) => void
 *   onComplete   — (completedValueArray) => void, called once all 6 digits are filled
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
                onComplete?.(next);
                return;
            }
        }

        const digit = raw.replace(/\D/g, '').slice(-1);
        const next  = [...value];
        next[index] = digit;
        onChange(next);

        if (digit && index < 5) inputRefs.current[index + 1]?.focus();
        if (digit && index === 5 && next.every((d) => d)) onComplete?.(next);
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
