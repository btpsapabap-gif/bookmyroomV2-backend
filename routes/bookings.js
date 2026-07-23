import express from 'express';
import multer from 'multer';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { isValidIndianMobile } from '../utils/validators.js';

const router = express.Router();

// Accepts an optional ID proof image in the same request as the booking.
// If the request isn't multipart (plain JSON — the normal guest
// self-booking case), multer simply passes it through untouched.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed for ID proof.'));
    }
    cb(null, true);
  }
});

// GET /api/bookings - guests see their own, admin sees all
router.get('/', requireAuth, async (req, res) => {
  let query = supabase
    .from('bookings')
    .select('*, rooms(room_number, room_type), profiles(full_name, mobile_number)')
    .order('created_at', { ascending: false });

  if (req.profile.role !== 'admin') {
    query = query.eq('guest_id', req.user.id);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/bookings
// - Guests always book for themselves. Their ID proof must already be on
//   file (added via the ID Proof card) — no image upload happens here.
// - Admins may book for an existing guest (guest_id) or a walk-in
//   (guest_name + guest_mobile, auto-creates a lightweight profile).
// - Admins may optionally include id_proof_type / id_proof_number /
//   id_proof_image in this same request, which is saved onto whichever
//   guest ends up being booked for.
// - Regardless of path, the booking is REJECTED unless the guest's
//   profile ends up with a complete ID proof (type + number + image).
// - Also validates: no past dates, no overlapping booking for the room.
// total_cost is auto-calculated by a DB trigger from room price * nights
router.post('/', requireAuth, upload.single('id_proof_image'), async (req, res) => {
  const { room_id, from_date, to_date, guest_id, guest_name, guest_mobile, id_proof_type, id_proof_number } = req.body;

  if (!room_id || !from_date || !to_date) {
    return res.status(400).json({ error: 'room_id, from_date and to_date are required' });
  }

  // Reject past dates (compare as plain ISO date strings, no timezone math needed)
  const todayStr = new Date().toISOString().slice(0, 10);
  if (from_date < todayStr) {
    return res.status(400).json({ error: 'From date cannot be in the past.' });
  }
  if (to_date < from_date) {
    return res.status(400).json({ error: 'To date must be on or after the from date.' });
  }

  // Work out which guest this booking belongs to
  let targetGuestId = req.user.id; // default: guests book for themselves

  if (req.profile.role === 'admin') {
    if (guest_id) {
      targetGuestId = guest_id;
    } else if (guest_name && guest_mobile) {
      if (!isValidIndianMobile(guest_mobile)) {
        return res.status(400).json({ error: 'Guest mobile number must start with +91 followed by a 10-digit number (e.g. +919876543210).' });
      }
      // Walk-in guest: reuse an existing profile with this mobile number,
      // or create a lightweight one on the fly.
      const { data: existingGuest } = await supabase
        .from('profiles')
        .select('id')
        .eq('mobile_number', guest_mobile)
        .maybeSingle();

      if (existingGuest) {
        targetGuestId = existingGuest.id;
      } else {
        const bcrypt = (await import('bcryptjs')).default;
        const randomPassword = Math.random().toString(36).slice(-10);
        const password_hash = await bcrypt.hash(randomPassword, 10);
        const { data: created, error: createError } = await supabase
          .from('profiles')
          .insert([{ full_name: guest_name, mobile_number: guest_mobile, password_hash, role: 'guest' }])
          .select('id')
          .single();
        if (createError) return res.status(400).json({ error: createError.message });
        targetGuestId = created.id;
      }
    } else {
      return res.status(400).json({ error: 'Select an existing guest or provide a name and mobile number for a walk-in guest.' });
    }
  }

  // If ID proof details were included in this request, save them onto
  // the target guest's profile now (this is how a walk-in — or any
  // guest missing proof — gets it captured at booking time).
  if (id_proof_type && id_proof_number) {
    const updateFields = { id_proof_type, id_proof_number };

    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
      const storagePath = `${targetGuestId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase
        .storage
        .from('id-proofs')
        .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
      if (uploadError) return res.status(400).json({ error: uploadError.message });
      updateFields.id_proof_image_path = storagePath;
    }

    const { error: updateError } = await supabase.from('profiles').update(updateFields).eq('id', targetGuestId);
    if (updateError) return res.status(400).json({ error: updateError.message });
  }

  // ID proof is mandatory before any booking can be made — check the
  // profile's current state regardless of whether it was just updated above.
  const { data: guestProfile, error: guestError } = await supabase
    .from('profiles')
    .select('id_proof_type, id_proof_number, id_proof_image_path')
    .eq('id', targetGuestId)
    .single();

  if (guestError || !guestProfile) {
    return res.status(400).json({ error: 'Guest not found.' });
  }
  if (!guestProfile.id_proof_type || !guestProfile.id_proof_number || !guestProfile.id_proof_image_path) {
    return res.status(400).json({ error: 'ID proof (type, number, and photo) is required before this guest can book. Please add it first.' });
  }

  // Overlap check: reject if this room already has an active booking
  // (booked or checked_in) whose date range overlaps the requested one.
  const { data: overlapping, error: overlapError } = await supabase
    .from('bookings')
    .select('id')
    .eq('room_id', room_id)
    .in('status', ['booked', 'checked_in'])
    .lte('from_date', to_date)
    .gte('to_date', from_date);

  if (overlapError) return res.status(400).json({ error: overlapError.message });
  if (overlapping.length > 0) {
    return res.status(409).json({ error: 'This room is already booked for an overlapping date range.' });
  }

  const { data, error } = await supabase
    .from('bookings')
    .insert([{
      guest_id: targetGuestId,
      room_id,
      from_date,
      to_date,
      status: 'booked'
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });

  // Reflect the booking on the room itself so it stops showing up as
  // available for other guests/admins to select.
  await supabase.from('rooms').update({ status: 'occupied' }).eq('id', room_id);

  res.status(201).json(data[0]);
});

// PATCH /api/bookings/:id/check-in - admin checks a guest in
router.patch('/:id/check-in', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'checked_in', check_in_time: new Date().toISOString() })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

// PATCH /api/bookings/:id/check-out - admin checks a guest out
router.patch('/:id/check-out', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'checked_out', check_out_time: new Date().toISOString() })
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });

  // Room is free again once the guest has checked out.
  if (data[0]) {
    await supabase.from('rooms').update({ status: 'available' }).eq('id', data[0].room_id);
  }

  res.json(data[0]);
});

// PATCH /api/bookings/:id/cancel - guest (own) or admin cancels
router.patch('/:id/cancel', requireAuth, async (req, res) => {
  const { id } = req.params;
  let query = supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  if (req.profile.role !== 'admin') {
    query = query.eq('guest_id', req.user.id);
  }
  const { data, error } = await query.select();
  if (error) return res.status(400).json({ error: error.message });
  if (!data.length) return res.status(404).json({ error: 'Booking not found or not yours' });

  // Room is free again once the booking holding it is cancelled.
  await supabase.from('rooms').update({ status: 'available' }).eq('id', data[0].room_id);

  res.json(data[0]);
});

export default router;
