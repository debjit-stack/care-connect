import mongoose from 'mongoose';
import tenantPlugin from '../plugins/tenantPlugin.js';

const doctorSchema = mongoose.Schema(
    {
        user: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'User',
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
doctorSchema.index({ organisationId: 1 });
doctorSchema.index({ deletedAt: 1 });

const Doctor = mongoose.model('Doctor', doctorSchema);
export default Doctor;
