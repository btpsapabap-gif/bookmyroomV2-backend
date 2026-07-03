import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import roomsRoutes from './routes/rooms.js';
import bookingsRoutes from './routes/bookings.js';
import reportsRoutes from './routes/reports.js';
import guestsRoutes from './routes/guests.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trim any trailing slash so "https://x.vercel.app/" in the env var
// still matches the browser's origin "https://x.vercel.app" exactly.
const allowedOrigin = (process.env.FRONTEND_URL || '*').replace(/\/+$/, '');
app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'BookMyRoom API is running' }));

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/guests', guestsRoutes);

app.listen(PORT, () => {
  console.log(`BookMyRoom API listening on port ${PORT}`);
});
