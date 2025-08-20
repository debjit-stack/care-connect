import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';

// Import all route files
import authRoutes from './routes/authRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import receptionistRoutes from './routes/receptionistRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import healthPackageRoutes from './routes/healthPackageRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';

// Load environment variables
dotenv.config();

// Connect to the database
connectDB();

const app = express();

// --- Middleware ---

// CORS Configuration: This is crucial for your live site to work.
// It tells your backend to accept requests from your Netlify frontend AND your local machine.
const allowedOrigins = ['https://ccmanagement.netlify.app', 'http://localhost:3000'];

const corsOptions = {
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  optionsSuccessStatus: 200 
};
app.use(cors(corsOptions));


// JSON Body Parser
app.use(express.json());

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/receptionist', receptionistRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/packages', healthPackageRoutes);
app.use('/api/dashboard', dashboardRoutes);

// A simple test route to check if the server is running
app.get('/', (req, res) => {
    res.send('CareConnect API is up and running!');
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
