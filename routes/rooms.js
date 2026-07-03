import express from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/rooms - list all rooms (any logged-in user)
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('rooms').select('*').order('room_number');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/rooms - create a room (admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { room_number, room_type, price_per_night, status } = req.body;
  const { data, error } = await supabase
    .from('rooms')
    .insert([{ room_number, room_type, price_per_night, status }])
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data[0]);
});

// PUT /api/rooms/:id - update a room (admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('rooms')
    .update(req.body)
    .eq('id', id)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data[0]);
});

// DELETE /api/rooms/:id - delete a room (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('rooms').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).send();
});

export default router;
