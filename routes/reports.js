import express from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { supabase } from '../supabaseClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Shared helper: fetch bookings with optional filters
async function fetchBookings({ from, to, status, room_id }) {
  let query = supabase
    .from('bookings')
    .select('*, rooms(room_number, room_type), profiles(full_name, mobile_number)')
    .order('from_date', { ascending: true });

  if (from) query = query.gte('from_date', from);
  if (to) query = query.lte('to_date', to);
  if (status) query = query.eq('status', status);
  if (room_id) query = query.eq('room_id', room_id);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// GET /api/reports/excel?from=2026-01-01&to=2026-01-31&status=checked_out
router.get('/excel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const bookings = await fetchBookings(req.query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Bookings');

    sheet.columns = [
      { header: 'Guest Name', key: 'guest_name', width: 22 },
      { header: 'Mobile Number', key: 'mobile', width: 16 },
      { header: 'Room No.', key: 'room_number', width: 10 },
      { header: 'Room Type', key: 'room_type', width: 12 },
      { header: 'From Date', key: 'from_date', width: 14 },
      { header: 'To Date', key: 'to_date', width: 14 },
      { header: 'Check-in Time', key: 'check_in_time', width: 20 },
      { header: 'Check-out Time', key: 'check_out_time', width: 20 },
      { header: 'Total Cost (₹)', key: 'total_cost', width: 14 },
      { header: 'Status', key: 'status', width: 14 }
    ];
    sheet.getRow(1).font = { bold: true };

    bookings.forEach((b) => {
      sheet.addRow({
        guest_name: b.profiles?.full_name || '',
        mobile: b.profiles?.mobile_number || '',
        room_number: b.rooms?.room_number || '',
        room_type: b.rooms?.room_type || '',
        from_date: b.from_date,
        to_date: b.to_date,
        check_in_time: b.check_in_time || '-',
        check_out_time: b.check_out_time || '-',
        total_cost: b.total_cost,
        status: b.status
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=bookings_report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/pdf?from=2026-01-01&to=2026-01-31&status=checked_out
router.get('/pdf', requireAuth, requireAdmin, async (req, res) => {
  try {
    const bookings = await fetchBookings(req.query);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=bookings_report.pdf');

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(18).text('BookMyRoom — Bookings Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('gray')
      .text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('black');

    bookings.forEach((b, i) => {
      doc.fontSize(11).font('Helvetica-Bold')
        .text(`${i + 1}. ${b.profiles?.full_name || 'Unknown'} — Room ${b.rooms?.room_number || '-'} (${b.rooms?.room_type || '-'})`);
      doc.font('Helvetica').fontSize(10)
        .text(`Mobile: ${b.profiles?.mobile_number || '-'}`)
        .text(`Stay: ${b.from_date} to ${b.to_date}`)
        .text(`Check-in: ${b.check_in_time || '-'}   Check-out: ${b.check_out_time || '-'}`)
        .text(`Total Cost: Rs. ${b.total_cost}   Status: ${b.status}`);
      doc.moveDown(1);
    });

    if (bookings.length === 0) {
      doc.fontSize(11).text('No bookings found for the selected filters.');
    }

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
