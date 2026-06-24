import mongoose from 'mongoose';
import tenantPlugin from '../plugins/tenantPlugin.js';

const appointmentSchema = mongoose.Schema(
    {
        patient: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'User',
        },
        doctor: {
            type:     mongoose.Schema.Types.ObjectId,
            required: true,
            ref:      'Doctor',
        },
        appointmentDate: { type: Date,   required: true },
        appointmentTime: { type: String, required: true },
        type: {
            type:     String,
            enum:     ['Online', 'Offline'],
            required: true,
        },
        status: {
            type:    String,
            enum:    ['Scheduled', 'Completed', 'Cancelled'],
            default: 'Scheduled',
        },
        notes:        { type: String, default: null },
        prescription: { type: String, default: null },
    },
    { timestamps: true }
);

appointmentSchema.plugin(tenantPlugin);

// Unique active slot — scoped per org (two orgs can have same doctor+date+time)
appointmentSchema.index(
    { doctor: 1, appointmentDate: 1, appointmentTime: 1, organisationId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: { $ne: 'Cancelled' } },
        name: 'unique_active_appointment_slot',
    }
);
appointmentSchema.index({ patient: 1, organisationId: 1, appointmentDate: -1 });
appointmentSchema.index({ doctor:  1, organisationId: 1, appointmentDate: -1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);
export default Appointment;
