/**
 * server/utils/mailer.js
 * ──────────────────────
 * Nodemailer transport factory.
 * P3D: Added 4 security email templates.
 * All existing templates and sendMail() are preserved unchanged.
 */

import nodemailer from 'nodemailer';

// ── Build transport ───────────────────────────────────────────────────────────
const buildTransport = (org) => {
    const orgSmtp = org?.settings?.smtp;
    if (orgSmtp?.host) {
        return nodemailer.createTransport({
            host:   orgSmtp.host,
            port:   orgSmtp.port   || 587,
            secure: orgSmtp.secure || false,
            auth:   { user: orgSmtp.user, pass: orgSmtp.pass },
        });
    }
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host:   process.env.SMTP_HOST,
            port:   parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    }
    return null;
};

// ── From address ──────────────────────────────────────────────────────────────
const buildFromAddress = (org) => {
    const orgName = org?.name || process.env.APP_NAME || 'CareConnect';
    const fromEmail =
        org?.settings?.smtp?.from ||
        process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        'noreply@careconnect.app';
    return `"${orgName}" <${fromEmail}>`;
};

// ── Email wrapper ─────────────────────────────────────────────────────────────
const emailWrapper = (orgName, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f3f4f6; margin: 0; padding: 20px; }
    .card { background: #ffffff; border-radius: 8px; max-width: 520px; margin: 0 auto; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { color: #1d4ed8; font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
    .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .value { color: #111827; font-size: 15px; font-weight: 600; margin-bottom: 12px; }
    .badge { display: inline-block; background: #dbeafe; color: #1d4ed8; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .badge-green { display: inline-block; background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .badge-red { display: inline-block; background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    .alert-red { background: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 4px; margin: 16px 0; }
    .footer { color: #9ca3af; font-size: 12px; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">${orgName}</div>
    <hr class="divider">
    ${content}
    <div class="footer">This is an automated security notification from ${orgName}. Please do not reply.</div>
  </div>
</body>
</html>
`;

// ── Templates ─────────────────────────────────────────────────────────────────
export const templates = {
    // ── Existing templates (unchanged) ─────────────────────────────────────────
    appointmentConfirmation: ({ patientName, doctorName, date, time, type, org }) => ({
        subject: `Appointment Confirmed — ${date} at ${time}`,
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${patientName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">Your appointment has been successfully booked.</p>
            <div class="label">Doctor</div>
            <div class="value">${doctorName}</div>
            <div class="label">Date</div>
            <div class="value">${date}</div>
            <div class="label">Time</div>
            <div class="value">${time}</div>
            <div class="label">Type</div>
            <div class="value"><span class="badge">${type}</span></div>
            <hr class="divider">
            <p style="color:#6b7280;font-size:13px;">Please arrive 10 minutes early. To reschedule, contact the hospital directly.</p>
        `),
    }),

    appointmentCancellation: ({ patientName, doctorName, date, time, reason, org }) => ({
        subject: `Appointment Cancelled — ${date} at ${time}`,
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${patientName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">Your appointment has been cancelled.</p>
            <div class="label">Doctor</div>
            <div class="value">${doctorName}</div>
            <div class="label">Date</div>
            <div class="value">${date}</div>
            <div class="label">Time</div>
            <div class="value">${time}</div>
            ${reason ? `<div class="label">Reason</div><div class="value">${reason}</div>` : ''}
            <hr class="divider">
            <p style="color:#6b7280;font-size:13px;">Please contact us to reschedule your appointment.</p>
        `),
    }),

    consultationSummary: ({ patientName, doctorName, date, notes, prescription, org }) => ({
        subject: `Consultation Summary — ${date}`,
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${patientName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">Here is a summary of your consultation on <strong>${date}</strong>.</p>
            <div class="label">Doctor</div>
            <div class="value">${doctorName}</div>
            ${notes ? `<div class="label">Clinical Notes</div><div class="value" style="white-space:pre-line;">${notes}</div>` : ''}
            ${prescription ? `<div class="label">Prescription</div><div class="value" style="white-space:pre-line;">${prescription}</div>` : ''}
            <hr class="divider">
            <p style="color:#6b7280;font-size:13px;">Please follow your doctor's advice. Contact us if you have any concerns.</p>
        `),
    }),

    passwordResetByAdmin: ({ userName, org }) => ({
        subject: 'Your Password Has Been Reset',
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${userName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">Your account password has been reset by an administrator.</p>
            <p style="color:#374151;font-size:15px;">You will need to use your new temporary password to log in. Please change it immediately after signing in.</p>
            <hr class="divider">
            <p style="color:#dc2626;font-size:13px;">If you did not request this change, please contact your system administrator immediately.</p>
        `),
    }),

    // ── P3D: Security email templates ──────────────────────────────────────────

    // Sent to user after they successfully enable MFA on their account
    mfaEnabled: ({ userName, org }) => ({
        subject: '✅ Two-Factor Authentication Enabled',
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${userName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">
                <span class="badge-green">MFA Enabled</span>
            </p>
            <p style="color:#374151;font-size:15px;">
                Two-factor authentication has been successfully enabled on your account.
                From now on, you will need your authenticator app code to log in.
            </p>
            <div class="alert">
                <strong style="color:#92400e;">Keep your recovery codes safe.</strong>
                <p style="color:#78350f;margin:4px 0 0;">
                    If you lose access to your authenticator app, you will need your recovery codes to regain access.
                    Store them somewhere safe offline.
                </p>
            </div>
            <hr class="divider">
            <p style="color:#dc2626;font-size:13px;">
                If you did not enable MFA, your account may be compromised.
                Contact your administrator immediately.
            </p>
        `),
    }),

    // Sent to user after they disable MFA
    mfaDisabled: ({ userName, org }) => ({
        subject: '⚠️ Two-Factor Authentication Disabled',
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${userName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">
                <span class="badge-red">MFA Disabled</span>
            </p>
            <p style="color:#374151;font-size:15px;">
                Two-factor authentication has been <strong>disabled</strong> on your account.
                Your account is now less secure.
            </p>
            <div class="alert-red">
                <strong style="color:#991b1b;">Was this you?</strong>
                <p style="color:#7f1d1d;margin:4px 0 0;">
                    If you did not disable MFA, your account may be compromised.
                    Contact your administrator immediately and change your password.
                </p>
            </div>
        `),
    }),

    // Sent to affected user when admin resets their MFA enrollment
    mfaResetByAdmin: ({ userName, adminName, org }) => ({
        subject: '🔑 Your MFA Has Been Reset by an Administrator',
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${userName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">
                Your two-factor authentication enrollment has been reset by an administrator
                (<strong>${adminName}</strong>).
            </p>
            <p style="color:#374151;font-size:15px;">
                You will be prompted to set up MFA again the next time you log in.
            </p>
            <div class="alert">
                <strong style="color:#92400e;">Action required.</strong>
                <p style="color:#78350f;margin:4px 0 0;">
                    Re-enroll your authenticator app on next login to restore full account security.
                </p>
            </div>
            <hr class="divider">
            <p style="color:#dc2626;font-size:13px;">
                If you believe this was done in error, contact your administrator.
            </p>
        `),
    }),

    // Sent to user when admin forces MFA on their account
    adminForcedMfa: ({ userName, adminName, org }) => ({
        subject: '🔒 MFA Now Required for Your Account',
        html: emailWrapper(org?.name || 'CareConnect', `
            <p style="color:#374151;font-size:15px;">Dear <strong>${userName}</strong>,</p>
            <p style="color:#374151;font-size:15px;">
                An administrator (<strong>${adminName}</strong>) has required two-factor
                authentication for your account.
            </p>
            <p style="color:#374151;font-size:15px;">
                You will be prompted to set up an authenticator app the next time you log in.
                You will not be able to access the system until MFA is set up.
            </p>
            <div class="alert">
                <strong style="color:#92400e;">What you need to do.</strong>
                <p style="color:#78350f;margin:4px 0 0;">
                    Download an authenticator app (Google Authenticator, Authy, or any TOTP app)
                    before your next login.
                </p>
            </div>
        `),
    }),
};

// ── Main send function ────────────────────────────────────────────────────────
export const sendMail = async ({ to, subject, html, org = null }) => {
    try {
        const transport = buildTransport(org);
        if (!transport) {
            console.log(`[Mailer] Email skipped (not configured): "${subject}" → ${to}`);
            return;
        }
        await transport.sendMail({ from: buildFromAddress(org), to, subject, html });
        console.log(`[Mailer] Sent: "${subject}" → ${to}`);
    } catch (err) {
        console.error(`[Mailer] Failed to send "${subject}" → ${to}:`, err.message);
    }
};
