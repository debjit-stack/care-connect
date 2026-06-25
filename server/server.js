import express       from 'express';
import dotenv        from 'dotenv';
import cors          from 'cors';
import helmet        from 'helmet';
import cookieParser  from 'cookie-parser';
import connectDB     from './config/db.js';
import getRedisClient from './config/redis.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { resolveTenant }  from './middleware/tenantMiddleware.js';

import authRoutes          from './routes/authRoutes.js';
import doctorRoutes        from './routes/doctorRoutes.js';
import adminRoutes         from './routes/adminRoutes.js';
import receptionistRoutes  from './routes/receptionistRoutes.js';
import patientRoutes       from './routes/patientRoutes.js';
import healthPackageRoutes from './routes/healthPackageRoutes.js';
import dashboardRoutes     from './routes/dashboardRoutes.js';
import organisationRoutes  from './routes/organisationRoutes.js';
// L3 FIX: appointmentRoutes removed — legacy file with no validation/RBAC,
// superseded by patientRoutes and receptionistRoutes.

dotenv.config();
connectDB();
getRedisClient();

const app = express();

app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc:  ["'self'"],
            styleSrc:   ["'self'", "'unsafe-inline'"],
            imgSrc:     ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'"],
            frameSrc:   ["'none'"],
            objectSrc:  ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
}));

const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

app.use(cors({
    origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials:          true,
    optionsSuccessStatus: 200,
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());
app.set('trust proxy', 1);

// Global rate limiter
app.use('/api', apiRateLimiter);

// Tenant resolution — runs before all route handlers.
// Auth routes bypass via PUBLIC_PATHS in tenantMiddleware.
// C1 FIX: resolveTenant no longer relies on req.user — it does its own
// org auto-detection, so the ordering of protect vs resolveTenant is not
// a problem. protect() runs later at the individual route level.
app.use('/api', resolveTenant);

// Routes
app.use('/api/auth',          authRoutes);
app.use('/api/organisations', organisationRoutes);
app.use('/api/doctors',       doctorRoutes);
app.use('/api/admin',         adminRoutes);
app.use('/api/receptionist',  receptionistRoutes);
app.use('/api/patient',       patientRoutes);
app.use('/api/packages',      healthPackageRoutes);
app.use('/api/dashboard',     dashboardRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));

app.use((err, _req, res, _next) => {
    console.error('[Server] unhandled error:', err);
    const status  = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message;
    res.status(status).json({ message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
    console.log(`[Server] running on port ${PORT} (${process.env.NODE_ENV || 'development'})`)
);
