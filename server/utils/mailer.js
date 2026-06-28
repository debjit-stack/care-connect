/**
 * server/utils/mailer.js
 * ──────────────────────
 * Nodemailer transport factory.
 *
 * Config resolution order (first found wins):
 *   1. org.settings.smtp  — per-org SMTP (white-label, future use)
 *   2. ENV vars            — SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
 *   3. Disabled            — if neither is configured, emails are skipped silently
 *
 * IMPORTANT: sendMail() NEVER throws. Email failures must never crash a booking
 * or any other primary operation. All failures are logged and swallowed.
 *
 * Usage:
 *   import { sendMail } from '../utils/mailer.js';
 *
 *   // Fire-and-forget (do NOT await in request handlers)
 *   sendMail({
 *       to:      'patient@example.com',
 *       subject: 'Appointment Confirmed',
 *       html:    '<p>Your appointment is booked.</p>',
 *       org,      // optional — used for per-org from address / branding
 *   });
 */

import nodemailer from 'nodemailer';

// ── Build transport from org settings or env ──────────────────────────────────
const buildTransport = (org) => {
    // Per-org SMTP (stored in org.settings.smtp)
    const orgSmtp = org?.settings?.smtp;
    if (orgSmtp?.host) {
        return nodemailer.createTransport({
            host:   orgSmtp.host,
            port:   orgSmtp.port   || 587,
            secure: orgSmtp.secure || false,
            auth: {
                user: orgSmtp.user,
                pass: orgSmtp.pass,
            },
        });
    }

    // Global SMTP from environment
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host:   process.env.SMTP_HOST,
            port:   parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    return null; // Email disabled
};

// ── From address ───────────────────────────────────────────────────────────────
const buildFromAddress = (org) => {
    const orgName = org?.name || process.env.APP_NAME || 'CareConnect';
    const fromEmail =
        org?.settings?.smtp?.from ||
        process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        'noreply@careconnect.app';

    return `"${orgName}" <${fromEmail}>`;
};

// ── Email templates ────────────────────────────────────────────────────────────
// All templates follow the same wrapper for consistent branding.
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
    .footer { color: #9ca3af; font-size: 12px; margin-top: 24px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">${orgName}</div>
    <hr class="divider">
    ${content}
    <div class="footer">This is an automated message from ${orgName}. Please do not reply.</div>
  </div>
</body>
</html>
`;

export const templates = {
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
};

// ── Main send function ─────────────────────────────────────────────────────────
/**
 * @param {object} options
 * @param {string}   options.to       — recipient email
 * @param {string}   options.subject  — email subject
 * @param {string}   options.html     — email HTML body
 * @param {object}   [options.org]    — org document (for from address + SMTP)
 */
export const sendMail = async ({ to, subject, html, org = null }) => {
    try {
        const transport = buildTransport(org);
        if (!transport) {
            // Email not configured — log and silently skip
            console.log(`[Mailer] Email skipped (not configured): "${subject}" → ${to}`);
            return;
        }

        await transport.sendMail({
            from:    buildFromAddress(org),
            to,
            subject,
            html,
        });

        console.log(`[Mailer] Sent: "${subject}" → ${to}`);
    } catch (err) {
        // NEVER throw — email failures must not crash the calling operation
        console.error(`[Mailer] Failed to send "${subject}" → ${to}:`, err.message);
    }
};
