import mongoose from 'mongoose';

const packageBookingSchema = mongoose.Schema({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User',
    },
    healthPackage: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'HealthPackage',
    },
    bookedBy: { // To know if patient or receptionist booked it
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User',
    },
    status: {
        type: String,
        enum: ['Booked', 'Completed', 'Cancelled'],
        default: 'Booked',
    },
}, {
    timestamps: true,
});

const PackageBooking = mongoose.model('PackageBooking', packageBookingSchema);
export default PackageBooking;
