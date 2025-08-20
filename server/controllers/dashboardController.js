import User from '../models/User.js';
import Doctor from '../models/Doctor.js';
import Appointment from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';

// @desc    Get data for the admin dashboard
// @route   GET /api/dashboard/stats
// @access  Private (Admin)
const getDashboardStats = async (req, res) => {
    try {
        // 1. KPI Cards Data
        const totalPatients = await User.countDocuments({ role: 'patient' });
        const totalDoctors = await User.countDocuments({ role: 'doctor' });
        const totalAppointments = await Appointment.countDocuments({});

        // Calculate total simulated revenue from package bookings
        const revenueData = await PackageBooking.aggregate([
            {
                $lookup: {
                    from: 'healthpackages', // the collection name for HealthPackage model
                    localField: 'healthPackage',
                    foreignField: '_id',
                    as: 'packageDetails'
                }
            },
            { $unwind: '$packageDetails' },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$packageDetails.price' }
                }
            }
        ]);
        const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;

        // 2. Recent Activity Data
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newPatientsLast30Days = await User.countDocuments({
            role: 'patient',
            createdAt: { $gte: thirtyDaysAgo }
        });

        const recentAppointments = await Appointment.find({})
            .populate('patient', 'name')
            .populate({
                path: 'doctor',
                populate: { path: 'user', select: 'name' }
            })
            .sort({ createdAt: -1 })
            .limit(5);

        // 3. Chart Data: Appointments per month for the last 12 months
        const appointmentsByMonth = await Appointment.aggregate([
            {
                $group: {
                    _id: {
                        year: { $year: '$appointmentDate' },
                        month: { $month: '$appointmentDate' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            {
                $project: {
                    _id: 0,
                    month: '$_id.month',
                    year: '$_id.year',
                    count: '$count'
                }
            }
        ]);

        res.json({
            kpi: {
                totalPatients,
                totalDoctors,
                totalAppointments,
                totalRevenue
            },
            recentActivity: {
                newPatientsLast30Days,
                recentAppointments
            },
            charts: {
                appointmentsByMonth
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

export { getDashboardStats };