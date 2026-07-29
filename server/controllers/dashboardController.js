import User           from '../models/User.js';
import Doctor          from '../models/Doctor.js';
import Membership      from '../models/Membership.js';
import Appointment    from '../models/Appointment.js';
import PackageBooking from '../models/PackageBooking.js';
import HealthPackage  from '../models/HealthPackage.js';

// ─── GET /api/dashboard/stats ─────────────────────────────────────────────────
// PHASE M6/M7 FOLLOW-UP FIX: totalPatients/totalDoctors and
// newPatientsLast30Days/newPatientsByMonth previously counted directly
// against User (filtered by the legacy, single-value User.organisationId +
// User.role fields, via tenantPlugin's implicit ambient-org filter). Same
// root cause as the doctor-visibility bug fixed earlier in this
// investigation: an identity that belongs to MULTIPLE organisations only
// ever has one (stale) value in User.organisationId — so a "common" doctor
// or patient who has an active relationship with this org, but was
// originally CREATED at a different org, was silently excluded from every
// count here, regardless of having a perfectly valid active Membership at
// this org right now. This is exactly what was reported: "common doctors
// are getting excluded in total counting number."
//
// Fixed by counting Membership documents (status: 'active', scoped by
// organisationId + role) instead of User documents — Membership is the
// authoritative source for "who currently belongs to this organisation, in
// what capacity" since Phase M3, and every other admin-facing count in this
// function should eventually follow the same pattern (see follow-up note
// at the bottom of this file).
const getDashboardStats = async (req, res) => {
    try {
        const orgId = req.orgId;

        // ── KPIs — now Membership-based ─────────────────────────────────────
        const [totalPatients, totalDoctors, totalAppointments] = await Promise.all([
            Membership.countDocuments({ organisationId: orgId, role: 'patient', status: 'active' }),
            Membership.countDocuments({ organisationId: orgId, role: 'doctor',  status: 'active' }),
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

        // "New patients" now means "new active patient MEMBERSHIP at this
        // org" (joinedAt within the window) rather than "new User document
        // created" — correctly counts an existing identity who was JUST
        // added as a patient at this org (e.g. via the M5 identity-reuse
        // flow), not only genuinely brand-new accounts.
        const newPatientsLast30Days = await Membership.countDocuments({
            organisationId: orgId,
            role:           'patient',
            status:         'active',
            joinedAt:       { $gte: thirtyDaysAgo },
        });

        const recentAppointments = await Appointment
            .find({ organisationId: orgId })
            .skipTenantFilter()
            .populate('patient', 'name')
            .populate({ path: 'doctor', populate: { path: 'user', select: 'name' } })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

        // ── Chart aggregations ────────────────────────────────────────────────

        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1);
        twelveMonthsAgo.setUTCHours(0, 0, 0, 0);

        const appointmentsByMonth = await Appointment.aggregate([
            { $match: { organisationId: orgId, appointmentDate: { $gte: twelveMonthsAgo } } },
            { $group: { _id: { year: { $year: '$appointmentDate' }, month: { $month: '$appointmentDate' } }, count: { $sum: 1 } } },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $project: { _id: 0, year: '$_id.year', month: '$_id.month', count: 1 } },
        ]);

        const appointmentsByStatus = await Appointment.aggregate([
            { $match: { organisationId: orgId } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $project: { _id: 0, status: '$_id', count: 1 } },
        ]);

        const appointmentsByType = await Appointment.aggregate([
            { $match: { organisationId: orgId } },
            { $group: { _id: '$type', count: { $sum: 1 } } },
            { $project: { _id: 0, type: '$_id', count: 1 } },
        ]);

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

        // New patients per month — same Membership-based fix as
        // newPatientsLast30Days above, applied to the 6-month chart series.
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setUTCHours(0, 0, 0, 0);

        const newPatientsByMonth = await Membership.aggregate([
            { $match: { organisationId: orgId, role: 'patient', status: 'active', joinedAt: { $gte: sixMonthsAgo } } },
            { $group: { _id: { year: { $year: '$joinedAt' }, month: { $month: '$joinedAt' } }, count: { $sum: 1 } } },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            { $project: { _id: 0, year: '$_id.year', month: '$_id.month', count: 1 } },
        ]);

        res.json({
            kpi: { totalPatients, totalDoctors, totalAppointments, totalRevenue },
            recentActivity: { newPatientsLast30Days, recentAppointments },
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
// Unchanged — Appointment records carry their own organisationId directly
// and are not affected by the User-identity staleness issue.
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

// PHASE M6/M7 FOLLOW-UP NOTE: `topDoctors` above still $lookup's `users` by
// `doctor.user` (the legacy Doctor.user field, not membershipId) purely for
// display purposes (doctor's name/specialty in an aggregation result) — not
// for org-scoping (the pipeline is already correctly scoped to `orgId` at
// the Appointment/Doctor level before that lookup happens), so it is not
// affected by the staleness bug this fix addresses. Flagged for
// completeness, not changed, since it's read-only display data already
// correctly scoped upstream.
