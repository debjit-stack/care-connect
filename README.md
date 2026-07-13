# CareConnect - Multi-Tenant Hospital Management SaaS

![CareConnect Banner](https://placehold.co/1200x300/3B82F6/FFFFFF?text=CareConnect&font=raleway)

**CareConnect** is a multi-tenant, full-stack hospital management SaaS platform built with the MERN stack. It provides a secure, role-based, per-organisation-isolated system for hospital admins, doctors, receptionists, and patients — plus a platform-level Super Admin layer for onboarding and managing multiple hospitals from a single deployment.

**Live Frontend:** [ccmanagement.netlify.app](https://ccmanagement.netlify.app/)
**Live Backend API:** [care-connect-api-1m1s.onrender.com](https://care-connect-api-1m1s.onrender.com/)

---

## ✨ Key Features

The application is divided into a public-facing website, per-organisation role-based dashboards, and a platform-level Super Admin console.

### Multi-Tenancy & Platform (Super Admin)
- **Hospital Onboarding:** Guided, multi-step flow that atomically creates a new organisation and its first admin user together (all-or-nothing transaction).
- **Tenant Isolation:** Every request is scoped server-side to a resolved organisation — enforced independently of client-supplied headers via JWT-embedded `organisationId` binding checks, not just implicit query filtering.
- **Platform Dashboard:** Cross-organisation stats, organisation list (including suspended orgs), and suspend/reactivate controls with automatic session revocation on suspension.
- **Dedicated Platform Login:** Super Admin authenticates through a structurally separate login route from hospital users, with account-enumeration protection.

### Patient Features
- **Self-Registration:** Email OTP-based verification (6-digit code, rate-limited, auto-expiring).
- **Find Doctors:** Browse a public, tenant-scoped list of available doctors and view their profiles.
- **Real-time Availability:** View a doctor's live available appointment slots for any given day.
- **Self-Service Booking:** Securely book appointments and health packages online.
- **Personal Dashboard & Profile:** View appointment/consultation history (including clinical notes and prescriptions), manage profile details (phone, DOB, blood group, allergies), and self-cancel appointments (with a 24-hour cutoff).
- **Forgot Password:** OTP-based, self-service password reset.
- **In-App Notifications:** Real-time notification bell for booking confirmations, cancellations, and consultation updates.

### Receptionist Features
- **Offline Booking:** Book appointments and health packages for walk-in or call-in patients.
- **Patient Management:** Register new patients and search existing ones (with injection-safe search).
- **Daily Schedule View:** View all appointments for a given day to manage patient flow.

### Doctor Features
- **Clinical Workspace:** Dashboard to view and manage assigned appointments.
- **Patient History Access:** Securely access a patient's complete medical history and demographics (blood group, allergies, age) before a consultation, restricted to patients with an existing appointment relationship.
- **Update Records:** Add clinical notes and prescriptions after a consultation.
- **Schedule Management:** Manage weekly work availability.

### Admin Features (per organisation)
- **Command Center Dashboard:** KPI cards, revenue/appointment trend charts, doctor leaderboard, and package popularity analytics.
- **CSV Export:** Export appointment data over a custom date range.
- **Full CRUD Control:** Create, read, update, and delete users (patients, doctors, receptionists) scoped to the org.
- **Password Resets:** Securely reset any user's password within the organisation.
- **Service Management:** Full CRUD control over health packages.
- **Security Panel:** Manage organisation-wide MFA policy, view per-staff MFA status, force MFA on individual accounts, and reset a user's MFA enrollment.

### Security & Authentication
- **JWT Authentication** with short-lived access tokens (carrying a tenant-binding `organisationId` claim) and HTTP-only refresh cookies.
- **Multi-Factor Authentication (TOTP):** QR-based enrollment (Google Authenticator/Authy/Microsoft Authenticator compatible), with a live countdown, regeneration, and encrypted (AES-256-GCM) secret storage.
- **Recovery Codes:** 8 single-use, bcrypt-hashed backup codes generated at MFA enrollment, usable as a TOTP fallback, with regeneration support.
- **Rate Limiting & Lockout:** Tenant-aware login rate limiting, OTP attempt lockouts, and account lockout after repeated failed logins.
- **Audit Logging:** All authentication and data-mutation events are recorded, including a cross-organisation attribution marker for Super Admin actions.

---

## 🛠️ Technology Stack

- **Frontend:** React 19, Vite, React Router 7, Axios, Tailwind CSS, Recharts
- **Backend:** Node.js, Express 5
- **Database:** MongoDB Atlas (via Mongoose)
- **Cache / Sessions:** Redis (ioredis) — MFA setup sessions, OTP sessions, rate-limit counters
- **Authentication:** JSON Web Tokens (JWT), TOTP (speakeasy), bcrypt
- **Validation:** Zod
- **Email:** Nodemailer (per-organisation SMTP configuration supported)

---

## 🚀 Getting Started

To run this project locally, you will need to start the backend server, the frontend client, and a local Redis instance.

### Prerequisites
- Node.js (v18+)
- npm or yarn
- A MongoDB Atlas account (or local MongoDB instance)
- Redis (local install, or `REDIS_URL` pointing to a hosted instance)

### 1. Backend Setup (`/server`)

1.  Navigate to the `server` directory:
    ```bash
    cd server
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the `server` directory:
    ```env
    MONGO_URI=YOUR_MONGODB_ATLAS_CONNECTION_STRING
    PORT=5000

    # Auth secrets — use distinct, high-entropy values for each
    JWT_SECRET=YOUR_JWT_ACCESS_SECRET
    JWT_REFRESH_SECRET=YOUR_JWT_REFRESH_SECRET
    JWT_MFA_PENDING_SECRET=YOUR_JWT_MFA_PENDING_SECRET
    JWT_RESET_PENDING_SECRET=YOUR_JWT_RESET_PENDING_SECRET

    # MFA secret encryption — must be exactly 64 hex characters (32 bytes)
    MFA_ENCRYPTION_KEY=GENERATE_A_64_CHAR_HEX_STRING

    # Redis
    REDIS_URL=redis://127.0.0.1:6379
    # (or REDIS_HOST / REDIS_PORT / REDIS_USERNAME / REDIS_PASSWORD individually)

    # Multi-tenancy
    # Only set to true for local/single-tenant development convenience.
    ALLOW_SINGLE_ORG_AUTO_RESOLVE=false

    # SMTP (optional locally — emails are skipped/logged if unset)
    SMTP_HOST=
    SMTP_PORT=587
    SMTP_USER=
    SMTP_PASS=
    SMTP_FROM=

    CLIENT_ORIGIN=http://localhost:3030
    ```
4.  Start Redis locally (if not using a hosted `REDIS_URL`):
    ```bash
    redis-server
    ```
5.  (First run only) Create the initial Super Admin account:
    ```env
    # add to server/.env first
    SUPER_ADMIN_NAME=Your Name
    SUPER_ADMIN_EMAIL=you@example.com
    SUPER_ADMIN_PASSWORD=A_Strong_Temp_Password!
    ```
    ```bash
    node scripts/createSuperAdmin.js
    ```
6.  Start the server:
    ```bash
    npm run dev
    ```
    The backend will be running at `http://localhost:5000`.

### 2. Frontend Setup (`/client`)

1.  Open a new terminal and navigate to the `client` directory:
    ```bash
    cd client
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  (Optional) Create a `.env` file for a single-tenant local setup:
    ```env
    VITE_API_URL=http://localhost:5000/api
    VITE_ORGANISATION_SLUG=my-hospital
    ```
4.  Start the client:
    ```bash
    npm run dev
    ```
    The frontend will open in your browser at `http://localhost:3030`.

### 3. First-time setup flow

1.  Sign in at `/super-admin/login` with the Super Admin credentials created above.
2.  Use **Onboard New Hospital** to create your first organisation and its admin account in one guided flow.
3.  Sign in as that hospital's admin at `/login` (using the org's slug, resolved automatically once you've onboarded it) to start managing doctors, staff, and patients.

> Database migrations (schema backfills for auth fields, patient profile fields, and MFA recovery codes) are tracked in [`MIGRATIONS.md`](./MIGRATIONS.md). New environments created via the app itself don't need to run these manually — they only apply to pre-existing data from earlier schema versions.

---

## 🚢 Deployment

This application is deployed as two separate services:

- The **backend** is deployed as a Web Service on **Render**, with MongoDB Atlas and a managed Redis instance.
- The **frontend** is deployed as a static site on **Netlify**.

The live frontend is configured via environment variables to communicate with the live backend API. Individual hospital organisations are resolved either by subdomain or by an explicit `X-Organisation-Slug` header set per session after login/onboarding.

---

## 📄 Further Documentation

- [`MIGRATIONS.md`](./MIGRATIONS.md) — database migration history and current schema baseline
- [`AUTH_FLOW.md`](./AUTH_FLOW.md) — full authentication, tenant-resolution, and MFA flow reference
- [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) — feature completion status and remaining roadmap
