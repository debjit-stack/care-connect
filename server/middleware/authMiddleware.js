import User from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';

// ─── protect ──────────────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer ')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorised — no token provided' });
    }

    try {
        const decoded = verifyAccessToken(token);

        const user = await User
            .findById(decoded.id)
            .select('+passwordChangedAt')
            .skipTenantFilter();

        if (!user || user.deletedAt) {
            return res.status(401).json({ message: 'User no longer exists' });
        }

        if (user.isTokenIssuedBeforePasswordChange(decoded.iat)) {
            return res.status(401).json({
                message: 'Password recently changed. Please log in again.',
            });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Session expired. Please refresh your token.' });
        }
        return res.status(401).json({ message: 'Not authorised — invalid token' });
    }
};

// ─── Role guards ──────────────────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Not authorised' });
    }
    if (!roles.includes(req.user.role)) {
        return res.status(403).json({
            message: `Access denied. Required role: ${roles.join(' or ')}`,
        });
    }
    next();
};

// C2 FIX: admin guard now includes super_admin so super-admins can access
// all admin routes and the frontend /admin dashboard.
const admin                 = requireRole('admin', 'super_admin');
const doctor                = requireRole('doctor');
const isPatient             = requireRole('patient');
const isReceptionistOrAdmin = requireRole('receptionist', 'admin', 'super_admin');

export { protect, admin, doctor, isPatient, isReceptionistOrAdmin, requireRole };
