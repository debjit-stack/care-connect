import User           from '../models/User.js';
import Doctor         from '../models/Doctor.js';
import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';

// ─── GET /api/dashboard/stats ─────────────────────────────────────────────────
// Extended to include all chart data alongside existing KPI shape.
// Existing response fields are preserved exactly — additive only.
const getDashboardStats = async (req, res) => {
    try {
        const orgId = req.orgId;

        // ── Existing KPIs ─────────────────────────────────────────────────────
        const [totalPatients, totalDoctors, totalAppointments] = await Promise.all([
            User.countDocuments({ organisationId: orgId, role: 'patient',  deletedAt: null }).skipTenantFilter(),
            User.countDocuments({ organisationId: orgId, role: 'doctor',   deletedAt: null }).skipTenantFilter(),
            Appointment.countDocuments({ organisationId: orgId }).skipTenantFilter(),
        ]);

        const revenueData = await PackageBooking.aggregate([
            { $match: { organisationId: orgId } },
            { $lookup: { from: 'healthpackages', localField: 'healthPackage', foreignField: '_id', as: 'pkg' } },
            { $unwind: '$pkg' },
            { $match: { 'pkg.deletedAt': null } },
            { $group: { _id: null, totalRevenue: { $sum: '$pkg.price' } } },
        ]);
        const totalRevenue = revenueData[0]?.totalRevenue ?? 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const newPatientsLast30Days = await User.countDocuments({
            organisationId: orgId, role: 'patient', deletedAt: null,
            createdAt: { $gte: thirtyDaysAgo },
        }).skipTenantFilter();

        const recentAppointments = await Appointment
            .find({ organisationId: orgId })
            .skipTenantFilter()
            .populate('patient', 'name')
            .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        // ── WS3: New chart aggregations ───────────────────────────────────────

        // 1. Appointments by month (last 12 months) — line chart
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1);
        twelveMonthsAgo.setHours(0, 0, 0, 0);

        const appointmentsByMonth = await Appointment.aggregate([
            { $match: { organisationId: orgId, appointmentDate: { $gte: twelveMonthsAgo } } },
            { $group: { _id: { year: { $year: '$appointmentDate' }, month: { $month: '$appointmentDate' } }, count: { $sum: 1 } } },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $project: { _id: 0, year: '$_id.year', month: '$_id.month', count: 1 } },
        ]);

        // 2. Appointments by status — pie chart
        const appointmentsByStatus = await Appointment.aggregate([
            { $match: { organisationId: orgId } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { _id: 0, status: '$_id', count: 1 } },
        ]);

        // 3. Appointments by type (Online vs Offline) — donut chart
        const appointmentsByType = await Appointment.aggregate([
            { $match: { organisationId: orgId } },
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $project: { _id: 0, type: '$_id', count: 1 } },
        ]);

        // 4. Top 5 doctors by appointment count — horizontal bar chart
        const topDoctors = await Appointment.aggregate([
            { $match: { organisationId: orgId, status: { $ne: 'Cancelled' } } },
            { $group: { _id: '$doctor', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            { $lookup: { from: 'doctors', localField: '_id', foreignField: '_id', as: 'doctor' } },
            { $unwind: '$doctor' },
            { $lookup: { from: 'users', localField: 'doctor.user', foreignField: '_id', as: 'user' } },
            { $unwind: '$user' },
            { $project: { _id: 0, name: '$user.name', specialty: '$doctor.specialty', count: 1 } },
        ]);

        // 5. Package popularity — bar chart
        const packagePopularity = await PackageBooking.aggregate([
            { $match: { organisationId: orgId } },
            { $group: { _id: '$healthPackage', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 6 },
            { $lookup: { from: 'healthpackages', localField: '_id', foreignField: '_id', as: 'pkg' } },
            { $unwind: '$pkg' },
            { $match: { 'pkg.deletedAt': null } },
            { $project: { _id: 0, name: '$pkg.name', price: '$pkg.price', count: 1 } },
        ]);

        // 6. Revenue by month (last 12 months) — area chart
        const revenueByMonth = await PackageBooking.aggregate([
            { $match: { organisationId: orgId, createdAt: { $gte: twelveMonthsAgo } } },
            { $lookup: { from: 'healthpackages', localField: 'healthPackage', foreignField: '_id', as: 'pkg' } },
            { $unwind: '$pkg' },
            { $match: { 'pkg.deletedAt': null } },
            { $group: {
                _id:     { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                revenue: { $sum: '$pkg.price' },
                bookings:{ $sum: 1 },
            }},
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $project: { _id: 0, year: '$_id.year', month: '$_id.month', revenue: 1, bookings: 1 } },
        ]);

        // 7. New patients per month (last 6 months) — line chart
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const newPatientsByMonth = await User.aggregate([
            { $match: { organisationId: orgId, role: 'patient', deletedAt: null, createdAt: { $gte: sixMonthsAgo } } },
            { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $project: { _id: 0, year: '$_id.year', month: '$_id.month', count: 1 } },
        ]);

        res.json({
            // ── Preserved existing shape ───────────────────────────────────────
            kpi: { totalPatients, totalDoctors, totalAppointments, totalRevenue },
            recentActivity: { newPatientsLast30Days, recentAppointments },
            // ── WS3: Extended chart data ───────────────────────────────────────
            charts: {
                appointmentsByMonth,
                appointmentsByStatus,
                appointmentsByType,
                topDoctors,
                packagePopularity,
                revenueByMonth,
                newPatientsByMonth,
            },
        });
    } catch (err) {
        console.error('[Dashboard] getDashboardStats:', err.message);
        res.status(500).json({ message: 'Failed to load dashboard stats' });
    }
};

// ─── GET /api/dashboard/export ────────────────────────────────────────────────
// CSV export of appointments within a date range.
// Query params: from=YYYY-MM-DD, to=YYYY-MM-DD (both required)
// Returns: CSV attachment
const exportAppointments = async (req, res) => {
    try {
        const { from, to } = req.query;

        if (!from || !to) {
            return res.status(400).json({ message: 'Both from and to date parameters are required.' });
        }

        const fromDate = new Date(`${from}T00:00:00Z`);
        const toDate   = new Date(`${to}T23:59:59Z`);

        if (isNaN(fromDate) || isNaN(toDate)) {
            return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
        }

        if (fromDate > toDate) {
            return res.status(400).json({ message: 'From date must be before to date.' });
        }

        const orgId = req.orgId;

        const appointments = await Appointment
            .find({
                organisationId:  orgId,
                appointmentDate: { $gte: fromDate, $lte: toDate },
            })
            .skipTenantFilter()
            .populate('patient', 'name email')
            .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
            .sort({ appointmentDate: 1, appointmentTime: 1 })
            .lean();

        // Build CSV
        const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        const formatDate = (d) => {
            const date = new Date(d);
            return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
        };

        const escape = (v) => {
            if (v == null) return '';
            const s = String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const headers = ['Date', 'Time', 'Patient Name', 'Patient Email', 'Doctor Name', 'Specialty', 'Type', 'Status', 'Notes'];
        const rows = appointments.map((a) => [
            escape(formatDate(a.appointmentDate)),
            escape(a.appointmentTime),
            escape(a.patient?.name   ?? 'N/A'),
            escape(a.patient?.email  ?? 'N/A'),
            escape(a.doctor?.user?.name    ?? 'N/A'),
            escape(a.doctor?.specialty     ?? 'N/A'),
            escape(a.type),
            escape(a.status),
            escape(a.notes ?? ''),
        ]);

        const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

        const filename = `appointments_${from}_to_${to}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (err) {
        console.error('[Dashboard] exportAppointments:', err.message);
        res.status(500).json({ message: 'Failed to export appointments' });
    }
};

export { getDashboardStats, exportAppointments };
