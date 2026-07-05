import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../supabaseClient.js';
import { isValidIndianMobile } from '../utils/validators.js';

const router = express.Router();

// POST /api/auth/register
// Checks for a duplicate mobile number directly against the profiles
// table, hashes the password, and inserts a new guest row.
router.post('/register', async (req, res) => {
  const { mobile_number, password, full_name } = req.body;

  if (!mobile_number || !password || !full_name) {
    return res.status(400).json({ error: 'mobile_number, password and full_name are required' });
  }
  if (!isValidIndianMobile(mobile_number)) {
    return res.status(400).json({ error: 'Mobile number must start with +91 followed by a 10-digit number (e.g. +919876543210).' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Duplicate check
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('mobile_number', mobile_number)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'This mobile number is already registered.' });
  }

  const password_hash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from('profiles')
    .insert([{ full_name, mobile_number, password_hash, role: 'guest' }])
    .select('id, full_name, mobile_number, role')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json({ message: 'Registration successful. You can now log in.', profile: data });
});

// POST /api/auth/login
// Verifies mobile number + password against the stored hash and
// returns a signed JWT the frontend attaches to future requests.
router.post('/login', async (req, res) => {
  const { mobile_number, password } = req.body;

  if (!mobile_number || !password) {
    return res.status(400).json({ error: 'mobile_number and password are required' });
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('mobile_number', mobile_number)
    .maybeSingle();

  if (error || !profile) {
    return res.status(401).json({ error: 'Incorrect mobile number or password.' });
  }

  const passwordMatches = await bcrypt.compare(password, profile.password_hash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Incorrect mobile number or password.' });
  }

  const token = jwt.sign(
    { id: profile.id, full_name: profile.full_name, mobile_number: profile.mobile_number, role: profile.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    profile: { id: profile.id, full_name: profile.full_name, mobile_number: profile.mobile_number, role: profile.role }
  });
});

// GET /api/auth/me
// Returns the current user's profile based on the token. Used by the
// frontend on page load to restore the session.
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ profile: decoded });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

export default router;
