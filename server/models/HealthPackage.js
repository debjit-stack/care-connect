import mongoose from 'mongoose';

const healthPackageSchema = mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    price: {
        type: Number,
        required: true,
    },
    details: {
        type: String,
        required: true,
    },
}, {
    timestamps: true,
});

const HealthPackage = mongoose.model('HealthPackage', healthPackageSchema);
export default HealthPackage;