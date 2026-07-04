import mongoose from 'mongoose';

const organisationSchema = mongoose.Schema(
    {
        // ── Identity ─────────────────────────────────────────────────────────
        name: {
            type:      String,
            required:  [true, 'Organisation name is required'],
            trim:      true,
            maxlength: [200, 'Name cannot exceed 200 characters'],
        },

        // Subdomain used for tenant resolution in production:
        // hospital-abc.careconnect.in → slug = "hospital-abc"
        slug: {
            type:      String,
            required:  [true, 'Slug is required'],
            unique:    true,
            lowercase: true,
            trim:      true,
            match:     [/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, hyphens'],
        },

        // ── Contact ───────────────────────────────────────────────────────────
        contactEmail: {
            type:     String,
            required: [true, 'Contact email is required'],
            lowercase: true,
            trim:      true,
        },
        contactPhone: {
            type: String,
            trim: true,
        },
        address: {
            line1:   { type: String, trim: true },
            city:    { type: String, trim: true },
            state:   { type: String, trim: true },
            pincode: { type: String, trim: true },
            country: { type: String, trim: true, default: 'India' },
        },

        // ── Plan & billing ────────────────────────────────────────────────────
        plan: {
            type:    String,
            enum:    ['trial', 'basic', 'pro', 'enterprise'],
            default: 'trial',
        },
        // Trial expires 14 days after creation — set in pre-save hook
        trialEndsAt: {
            type: Date,
        },
        billingStatus: {
            type:    String,
            enum:    ['active', 'past_due', 'suspended', 'cancelled'],
            default: 'active',
        },

        // ── White-label settings ──────────────────────────────────────────────
        settings: {
            logoUrl:      { type: String, default: null },
            primaryColor: { type: String, default: '#3B82F6' },
            timezone:     { type: String, default: 'Asia/Kolkata' },
            locale:       { type: String, default: 'en-IN' },
            currency:     { type: String, default: 'INR' },
        },

        // ── Feature flags (Phase 4 — simple object until LaunchDarkly) ───────
        features: {
            onlineBooking:    { type: Boolean, default: true  },
            healthPackages:   { type: Boolean, default: true  },
            patientPortal:    { type: Boolean, default: true  },
            analytics:        { type: Boolean, default: false },
            // PATIENT MFA REMOVAL: this flag is interpreted as
            // "require MFA for STAFF logins" (admin/super_admin/doctor/
            // receptionist). It is never evaluated for patient logins — see
            // the centralized bypass gate in authController.loginUser. Field
            // name kept unchanged to avoid a migration; only its meaning and
            // the admin UI copy (SecurityPanel.jsx) were updated.
            mfaRequired:      { type: Boolean, default: false },
        },

        // ── Lifecycle ─────────────────────────────────────────────────────────
        isActive: {
            type:    Boolean,
            default: true,
        },
        suspendedAt: {
            type:    Date,
            default: null,
        },
        deletedAt: {
            type:    Date,
            default: null,
        },

        // ── Internal ──────────────────────────────────────────────────────────
        // The User._id of whoever created this org (super-admin action)
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref:  'User',
        },
    },
    { timestamps: true }
);

// ── Pre-save: set trial expiry on first creation ──────────────────────────────
organisationSchema.pre('save', function (next) {
    if (this.isNew && !this.trialEndsAt) {
        this.trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }
    next();
});

// ── Virtual: is the org on an active paid plan or valid trial? ────────────────
organisationSchema.virtual('isAccessible').get(function () {
    if (!this.isActive || this.deletedAt) return false;
    if (this.billingStatus === 'suspended' || this.billingStatus === 'cancelled') return false;
    if (this.plan === 'trial' && this.trialEndsAt < new Date()) return false;
    return true;
});

// ── Indexes ───────────────────────────────────────────────────────────────────
organisationSchema.index({ isActive: 1 });
organisationSchema.index({ deletedAt: 1 });

const Organisation = mongoose.model('Organisation', organisationSchema);
export default Organisation;
