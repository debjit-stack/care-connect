import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import tenantPlugin from '../plugins/tenantPlugin.js';

const userSchema = mongoose.Schema(
    {
        name: {
            type:      String,
            required:  [true, 'Name is required'],
            trim:      true,
            maxlength: [100, 'Name cannot exceed 100 characters'],
        },
        email: {
            type:      String,
            required:  [true, 'Email is required'],
            lowercase: true,
            trim:      true,
        },
        password: {
            type:     String,
            required: [true, 'Password is required'],
            select:   false,
        },
        role: {
            type:     String,
            required: true,
            enum:     ['patient', 'doctor', 'receptionist', 'admin', 'super_admin'],
            default:  'patient',
        },
        loginAttempts:     { type: Number,  default: 0,    select: false },
        lockUntil:         { type: Date,    default: null,  select: false },
        passwordChangedAt: { type: Date,    default: null,  select: false },
        deletedAt:         { type: Date,    default: null },

        // MFA
        mfaEnabled: {
            type: Boolean,
            default: false,
        },
        mfaSecret: {
            type: String,
            select: false,
        },
        forceMfa: {
            type: Boolean,
            default: false,
        },
        lastMfaResetAt: {
            type: Date,
            default: null,
        },

        // WS4: Patient profile fields (Migration 005)
        // Optional on all roles, but populated UI only shown for patients.
        phone: {
            type:    String,
            default: null,
            trim:    true,
        },
        dateOfBirth: {
            type:    Date,
            default: null,
        },
        bloodGroup: {
            type:    String,
            default: null,
            enum:    [null, 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
        },
        allergies: {
            type:      String,
            default:   '',
            trim:      true,
            maxlength: [500, 'Allergies field cannot exceed 500 characters'],
        },
    },
    { timestamps: true }
);

// Apply multi-tenancy plugin BEFORE defining indexes
userSchema.plugin(tenantPlugin);

// Unique email is scoped per-organisation (not global)
userSchema.index({ email: 1, organisationId: 1 }, { unique: true });
userSchema.index({ role: 1,  organisationId: 1 });
userSchema.index({ deletedAt: 1 });

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MS   = 15 * 60 * 1000;

userSchema.virtual('isLocked').get(function () {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt    = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    if (!this.isNew) this.passwordChangedAt = new Date(Date.now() - 1000);
    next();
});

userSchema.methods.matchPassword = async function (entered) {
    return bcrypt.compare(entered, this.password);
};

userSchema.methods.recordFailedLogin = async function () {
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({ $set: { loginAttempts: 1 }, $unset: { lockUntil: 1 } });
    }
    const update = { $inc: { loginAttempts: 1 } };
    if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS) {
        update.$set = { lockUntil: new Date(Date.now() + LOCK_DURATION_MS) };
    }
    return this.updateOne(update);
};

userSchema.methods.resetLoginAttempts = async function () {
    return this.updateOne({ $set: { loginAttempts: 0 }, $unset: { lockUntil: 1 } });
};

userSchema.methods.isTokenIssuedBeforePasswordChange = function (iat) {
    if (!this.passwordChangedAt) return false;
    return this.passwordChangedAt.getTime() / 1000 > iat;
};

const User = mongoose.model('User', userSchema);
export default User;
