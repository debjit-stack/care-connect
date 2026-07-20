import mongoose from 'mongoose';
import tenantPlugin from '../plugins/tenantPlugin.js';

const doctorSchema = mongoose.Schema(
    {
        user: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'User',
            // PHASE M4 NOTE: kept for backward compatibility during the
            // migration window. Once one User can have a Doctor profile at
            // MULTIPLE organisations simultaneously (the whole point of the
            // Membership redesign), this field alone is no longer
            // sufficient to disambiguate "which hospital's Doctor profile
            // is this" for self-service queries — that's what
            // `membershipId` below is for. `user` remains useful as a
            // direct "which person" reference (e.g. for admin tooling,
            // audit correlation) and is not removed until Phase M7, once
            // every read path has been confirmed to use membershipId where
            // disambiguation actually matters.
        },
        // PHASE M4 addition: the unambiguous link. One Doctor profile
        // belongs to exactly one Membership (one person, one role, one
        // organisation — per the approved architecture decision), and a
        // Membership can have at most one Doctor profile.
        membershipId: {
            type:     mongoose.Schema.Types.ObjectId,
            ref:      'Membership',
            default:  null,
            // Not `required: true` yet — existing Doctor documents are
            // backfilled by the Phase M4 migration, but making this
            // required at the schema level before the backfill runs would
            // break every existing Doctor.save() call in the interim.
            // Tightened to required in Phase M7 once backfill is confirmed
            // complete for 100% of live Doctor documents.
        },
        specialty: {
            type:     String,
            required: true,
            trim:     true,
        },
        qualifications: {
            type: String,
            trim: true,
        },
        experienceYears: {
            type: Number,
        },
        availability: [
            {
                day:       String,
                startTime: String,
                endTime:   String,
            },
        ],
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

doctorSchema.plugin(tenantPlugin);

doctorSchema.index({ user: 1, organisationId: 1 }, { unique: true });
// PHASE M4 addition: the new unambiguous unique key. Sparse because
// membershipId is null for not-yet-backfilled documents during the
// migration window; becomes a normal (non-sparse) unique index in M7 once
// membershipId is required.
doctorSchema.index({ membershipId: 1 }, { unique: true, sparse: true });
doctorSchema.index({ organisationId: 1 });
doctorSchema.index({ deletedAt: 1 });

const Doctor = mongoose.model('Doctor', doctorSchema);
export default Doctor;
