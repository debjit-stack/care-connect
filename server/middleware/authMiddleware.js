import User from '../models/User.js';
import { verifyAccessToken } from '../utils/tokens.js';

// ─── protect ──────────────────────────────────────────────────────────────────
// Validates the short-lived access token sent in the Authorization header.
// The client holds the access token in memory (not localStorage/cookie).
// Cookie is only used for the refresh token on /api/auth/* routes.

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

        // Fetch user — include passwordChangedAt to detect post-password-change tokens
        const user = await User
            .findById(decoded.id)
            .select('+passwordChangedAt');

        if (!user || user.deletedAt) {
            return res.status(401).json({ message: 'User no longer exists' });
        }

        // Reject tokens issued before a password change
        if (user.isTokenIssuedBeforePasswordChange(decoded.iat)) {
            return res.status(401).json({
                message: 'Password recently changed. Please log in again.',
            });
        }

        req.user = user;
        next();
    } catch (err) {
        // jwt.verify throws TokenExpiredError, JsonWebTokenError, etc.
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Session expired. Please refresh your token.' });
        }
        return res.status(401).json({ message: 'Not authorised — invalid token' });
    }
};

// ─── Role guards ──────────────────────────────────────────────────────────────
// Used as route-level middleware after protect().

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

// Convenience exports matching existing route usage
const admin                = requireRole('admin');
const doctor               = requireRole('doctor');
const isPatient            = requireRole('patient');
const isReceptionistOrAdmin = requireRole('receptionist', 'admin');

export { protect, admin, doctor, isPatient, isReceptionistOrAdmin, requireRole };
