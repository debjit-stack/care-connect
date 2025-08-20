import mongoose from 'mongoose';

const doctorSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User',
    },
    specialty: {
        type: String,
        required: true,
    },
    qualifications: {
        type: String,
    },
    experienceYears: {
        type: Number,
    },
    availability: [{
        day: String, // e.g., "Monday"
        startTime: String, // e.g., "09:00"
        endTime: String, // e.g., "17:00"
    }],
}, {
    timestamps: true,
});

const Doctor = mongoose.model('Doctor', doctorSchema);
export default Doctor;
