import express from 'express';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/guests - list all guest profiles (admin only)
// Used to populate the "book on behalf of" guest selector.
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, mobile_number, role, created_at')
    .eq('role', 'guest')
    .order('full_name');

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
