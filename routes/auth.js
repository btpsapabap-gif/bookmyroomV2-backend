import express from 'express';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// POST /api/auth/register
// Guests register with mobile number + password + full name.
// Uses the Supabase Admin API (service role) to create the user directly
// with phone_confirm: true, so no SMS/OTP provider is required.
// The 'handle_new_user' DB trigger auto-creates the matching profiles row.
router.post('/register', async (req, res) => {
  const { mobile_number, password, full_name } = req.body;

  if (!mobile_number || !password || !full_name) {
    return res.status(400).json({ error: 'mobile_number, password and full_name are required' });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    phone: mobile_number,
    password,
    phone_confirm: true,
    user_metadata: { full_name, mobile_number }
  });

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json({
    message: 'Registration successful. You can now log in.',
    user_id: data.user.id
  });
});

export default router;

// NOTE ON LOGIN:
// Login does NOT need a backend route. The frontend calls Supabase directly
// using the public anon key:
//
//   const { data, error } = await supabase.auth.signInWithPassword({
//     phone: mobileNumber,
//     password: password
//   });
//
// This returns a session/access_token which the frontend then sends as
// "Authorization: Bearer <token>" on all requests to this backend.
