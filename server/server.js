import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';


// Import route files
import authRoutes from './routes/authRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js'; // <-- ADD THIS LINE
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

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Enable JSON body parsing


// CORS Configuration: This is crucial for your live site to work.
// It tells your backend to accept requests from your Netlify frontend.
const corsOptions = {
  origin: 'https://ccmanagement.netlify.app/', 
  optionsSuccessStatus: 200 
};


// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes); // <-- ADD THIS LINE (and uncomment it)
app.use('/api/admin', adminRoutes);
app.use('/api/receptionist', receptionistRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/packages', healthPackageRoutes);
app.use('/api/dashboard', dashboardRoutes);


// A simple test route
app.get('/', (req, res) => {
    res.send('CareConnect API is up and running!');
});

const PORT = process.env.PORT || 5000;



app.listen(PORT, () => console.log(`Server running on port ${PORT}`));