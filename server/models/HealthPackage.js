import mongoose from 'mongoose';
import tenantPlugin from '../plugins/tenantPlugin.js';

const healthPackageSchema = mongoose.Schema(
    {
        name: {
            type:     String,
            required: true,
            trim:     true,
        },
        price: {
            type:     Number,
            required: true,
        },
        details: {
            type:     String,
            required: true,
        },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

healthPackageSchema.plugin(tenantPlugin);

healthPackageSchema.index({ organisationId: 1 });

const HealthPackage = mongoose.model('HealthPackage', healthPackageSchema);
export default HealthPackage;
