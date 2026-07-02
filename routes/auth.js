import express from 'express';
import { supabase } from '../supabaseClient.js';

const router = express.Router();

// We use mobile number as the login identifier, but Supabase's Phone auth
// provider requires a paid SMS provider (Twilio) to even be enabled, even
// though we never send an OTP. To avoid that dependency entirely, we store
// each user under a synthetic email derived from their mobile number and
// use Supabase's normal EMAIL auth under the hood. Users never see this —
// they only ever type their mobile number.
function mobileToSyntheticEmail(mobileNumber) {
  const digitsOnly = mobileNumber.replace(/[^\d]/g, ''); // strip '+' and spaces
  return `${digitsOnly}@bookmyroom.local`;
}

// POST /api/auth/register
// Guests register with mobile number + password + full name.
// Uses the Supabase Admin API (service role) to create the user directly
// with email_confirm: true, so no SMS/OTP or email provider is required.
// The 'handle_new_user' DB trigger auto-creates the matching profiles row,
// reading mobile_number from user_metadata.
router.post('/register', async (req, res) => {
  const { mobile_number, password, full_name } = req.body;

  if (!mobile_number || !password || !full_name) {
    return res.status(400).json({ error: 'mobile_number, password and full_name are required' });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: mobileToSyntheticEmail(mobile_number),
    password,
    email_confirm: true,
    user_metadata: { full_name, mobile_number }
  });

  if (error) {
    // Supabase returns a generic "already registered" message for duplicate emails
    if (error.message.toLowerCase().includes('already') ) {
      return res.status(400).json({ error: 'This mobile number is already registered.' });
    }
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({
    message: 'Registration successful. You can now log in.',
    user_id: data.user.id
  });
});

export default router;

// NOTE ON LOGIN:
// Login does NOT need a backend route. The frontend converts the mobile
// number to the same synthetic email format and calls Supabase directly
// using the public anon key:
//
//   const { data, error } = await supabase.auth.signInWithPassword({
//     email: `${digitsOnly}@bookmyroom.local`,
//     password: password
//   });
//
// This returns a session/access_token which the frontend then sends as
// "Authorization: Bearer <token>" on all requests to this backend.
