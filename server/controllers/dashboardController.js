import User           from '../models/User.js';
import Doctor         from '../models/Doctor.js';
import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';

// GET /api/dashboard/stats  (admin only, scoped to their org)
const getDashboardStats = async (req, res) => {
    try {
        const orgId = req.orgId;

        const [totalPatients, totalDoctors, totalAppointments] = await Promise.all([
            User.countDocuments({ organisationId: orgId, role: 'patient',  deletedAt: null }).skipTenantFilter(),
            User.countDocuments({ organisationId: orgId, role: 'doctor',   deletedAt: null }).skipTenantFilter(),
            Appointment.countDocuments({ organisationId: orgId }).skipTenantFilter(),
        ]);

        const revenueData = await PackageBooking.aggregate([
            { $match: { organisationId: orgId } },
            {
                $lookup: {
                    from:         'healthpackages',
                    localField:   'healthPackage',
                    foreignField: '_id',
                    as:           'packageDetails',
                },
            },
            { $unwind: '$packageDetails' },
            // C5 FIX: only count non-deleted packages in revenue
            { $match: { 'packageDetails.deletedAt': null } },
            { $group: { _id: null, totalRevenue: { $sum: '$packageDetails.price' } } },
        ]);
        const totalRevenue = revenueData[0]?.totalRevenue ?? 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const newPatientsLast30Days = await User.countDocuments({
            organisationId: orgId,
            role:           'patient',
            deletedAt:      null,
            createdAt:      { $gte: thirtyDaysAgo },
        }).skipTenantFilter();

        // L2 FIX: .skipTenantFilter() must come before .lean() — it sets a query
        // option and lean() terminates the chain. Correct order: find → skipTenantFilter
        // → populate → sort → limit → lean
        const recentAppointments = await Appointment
            .find({ organisationId: orgId })
            .skipTenantFilter()
            .populate('patient', 'name')
            .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        const appointmentsByMonth = await Appointment.aggregate([
            { $match: { organisationId: orgId } },
            {
                $group: {
                    _id:   { year: { $year: '$appointmentDate' }, month: { $month: '$appointmentDate' } },
                    count: { $sum: 1 },
                },
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $project: { _id: 0, year: '$_id.year', month: '$_id.month', count: 1 } },
        ]);

        res.json({
            kpi:            { totalPatients, totalDoctors, totalAppointments, totalRevenue },
            recentActivity: { newPatientsLast30Days, recentAppointments },
            charts:         { appointmentsByMonth },
        });
    } catch (err) {
        console.error('[Dashboard] getDashboardStats:', err.message);
        res.status(500).json({ message: 'Failed to load dashboard stats' });
    }
};

export { getDashboardStats };
