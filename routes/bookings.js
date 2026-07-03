import express from 'express';
import bcrypt from 'bcryptjs';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

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
// Guests always book for themselves. Admins may instead:
//   - pass guest_id to book on behalf of an existing guest, OR
//   - pass guest_name + guest_mobile for a walk-in who isn't registered
//     yet — we find-or-create a profile for them automatically.
// Validates: no past dates, no overlapping booking for the same room.
// total_cost is auto-calculated by a DB trigger from room price * nights
router.post('/', requireAuth, async (req, res) => {
  const { room_id, from_date, to_date, guest_id, guest_name, guest_mobile } = req.body;

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
    } else if (guest_mobile && guest_name) {
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
  res.json(data[0]);
});

export default router;
