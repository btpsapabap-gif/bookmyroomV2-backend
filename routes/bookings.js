import express from 'express';
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

// POST /api/bookings - guest creates a booking
// total_cost is auto-calculated by a DB trigger from room price * nights
router.post('/', requireAuth, async (req, res) => {
  const { room_id, from_date, to_date } = req.body;

  const { data, error } = await supabase
    .from('bookings')
    .insert([{
      guest_id: req.user.id,
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
