import mongoose from 'mongoose';
import tenantPlugin from '../plugins/tenantPlugin.js';

const packageBookingSchema = mongoose.Schema(
    {
        patient: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'User',
        },
        healthPackage: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'HealthPackage',
        },
        bookedBy: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'User',
        },
        status: {
            type:    String,
            enum:    ['Booked', 'Completed', 'Cancelled'],
            default: 'Booked',
        },
    },
    { timestamps: true }
);

packageBookingSchema.plugin(tenantPlugin);

packageBookingSchema.index({ patient:       1, organisationId: 1 });
packageBookingSchema.index({ healthPackage: 1, organisationId: 1 });

const PackageBooking = mongoose.model('PackageBooking', packageBookingSchema);
export default PackageBooking;
