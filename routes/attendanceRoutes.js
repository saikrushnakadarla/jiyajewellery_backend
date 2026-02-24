const express = require('express');
const db = require('../db');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for attendance photo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/attendance';
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'attendance-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Helper function to sanitize numbers
const sanitizeNumber = (value, defaultValue = null) => {
  if (value === "" || value === null || value === undefined) {
    return defaultValue;
  }
  return parseFloat(value);
};

// CHECK-IN API - POST /attendance/check-in
router.post('/check-in', upload.single('photo'), async (req, res) => {
  try {
    const { 
      salesperson_id, 
      salesperson_name,
      location, 
      latitude, 
      longitude,
      remarks,
      ip_address 
    } = req.body;

    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date();
    const photoPath = req.file ? req.file.filename : null;

    // Check if already checked in today
    const [existing] = await db.query(
      'SELECT * FROM salesperson_attendance WHERE salesperson_id = ? AND date = ?',
      [salesperson_id, today]
    );

    if (existing.length > 0) {
      // Delete uploaded file if check-in fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        success: false, 
        message: 'Already checked in today' 
      });
    }

    // Determine status based on check-in time (after 10:00 AM is late)
    const checkInHour = currentTime.getHours();
    const checkInMinute = currentTime.getMinutes();
    let status = 'present';
    
    if (checkInHour > 10 || (checkInHour === 10 && checkInMinute > 0)) {
      status = 'late';
    }

    // Insert check-in record
    const [result] = await db.query(
      `INSERT INTO salesperson_attendance 
      (salesperson_id, salesperson_name, check_in_time, check_in_location, 
       check_in_latitude, check_in_longitude, check_in_ip, check_in_remarks, 
       check_in_photo, date, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        salesperson_id, 
        salesperson_name,
        currentTime, 
        location || null, 
        sanitizeNumber(latitude), 
        sanitizeNumber(longitude), 
        ip_address || null,
        remarks || null, 
        photoPath, 
        today, 
        status
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Check-in successful',
      data: {
        id: result.insertId,
        check_in_time: currentTime,
        status: status,
        photo: photoPath
      }
    });

  } catch (error) {
    // Delete uploaded file if database insertion fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Check-in error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check in', 
      error: error.message 
    });
  }
});

// CHECK-OUT API - POST /attendance/check-out
router.post('/check-out', upload.single('photo'), async (req, res) => {
  try {
    const { 
      salesperson_id,
      location, 
      latitude, 
      longitude,
      remarks,
      ip_address 
    } = req.body;

    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date();
    const photoPath = req.file ? req.file.filename : null;

    // Check if checked in today
    const [attendance] = await db.query(
      'SELECT * FROM salesperson_attendance WHERE salesperson_id = ? AND date = ?',
      [salesperson_id, today]
    );

    if (attendance.length === 0) {
      // Delete uploaded file if check-out fails
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        success: false, 
        message: 'No check-in record found for today' 
      });
    }

    if (attendance[0].check_out_time) {
      // Delete uploaded file if already checked out
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ 
        success: false, 
        message: 'Already checked out today' 
      });
    }

    // Calculate working hours
    const checkInTime = new Date(attendance[0].check_in_time);
    const workingHours = (currentTime - checkInTime) / (1000 * 60 * 60); // Convert to hours

    // Update check-out record
    await db.query(
      `UPDATE salesperson_attendance 
      SET check_out_time = ?, check_out_location = ?, 
          check_out_latitude = ?, check_out_longitude = ?, 
          check_out_ip = ?, check_out_remarks = ?, 
          check_out_photo = ?, working_hours = ?
      WHERE salesperson_id = ? AND date = ?`,
      [
        currentTime, 
        location || null, 
        sanitizeNumber(latitude), 
        sanitizeNumber(longitude), 
        ip_address || null,
        remarks || null, 
        photoPath, 
        workingHours.toFixed(2),
        salesperson_id, 
        today
      ]
    );

    res.status(200).json({
      success: true,
      message: 'Check-out successful',
      data: {
        check_out_time: currentTime,
        working_hours: workingHours.toFixed(2),
        photo: photoPath
      }
    });

  } catch (error) {
    // Delete uploaded file if database update fails
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Check-out error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to check out', 
      error: error.message 
    });
  }
});

// GET today's attendance status for a salesperson
router.get('/status/:salesperson_id', async (req, res) => {
  try {
    const { salesperson_id } = req.params;
    const today = new Date().toISOString().split('T')[0];

    const [attendance] = await db.query(
      'SELECT * FROM salesperson_attendance WHERE salesperson_id = ? AND date = ?',
      [salesperson_id, today]
    );

    if (attendance.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          checked_in: false,
          checked_out: false
        }
      });
    }

    // Parse the attendance record
    const record = attendance[0];
    
    res.status(200).json({
      success: true,
      data: {
        id: record.id,
        checked_in: true,
        checked_out: !!record.check_out_time,
        check_in_time: record.check_in_time,
        check_out_time: record.check_out_time,
        working_hours: record.working_hours,
        status: record.status,
        check_in_photo: record.check_in_photo,
        check_out_photo: record.check_out_photo,
        check_in_location: record.check_in_location,
        check_out_location: record.check_out_location
      }
    });

  } catch (error) {
    console.error('Error fetching attendance status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch attendance status', 
      error: error.message 
    });
  }
});

// GET attendance history for a salesperson
router.get('/history/:salesperson_id', async (req, res) => {
  try {
    const { salesperson_id } = req.params;
    const { month, year } = req.query;

    let query = 'SELECT * FROM salesperson_attendance WHERE salesperson_id = ?';
    let params = [salesperson_id];

    if (month && year) {
      query += ' AND MONTH(date) = ? AND YEAR(date) = ?';
      params.push(month, year);
    }

    query += ' ORDER BY date DESC';

    const [attendance] = await db.query(query, params);

    // Parse any JSON fields if needed (though attendance table doesn't have JSON fields)
    const parsedAttendance = attendance.map(record => ({
      ...record
    }));

    // Calculate monthly summary
    const summary = {
      total_days: attendance.length,
      present_days: attendance.filter(a => a.status === 'present').length,
      late_days: attendance.filter(a => a.status === 'late').length,
      half_days: attendance.filter(a => a.status === 'half_day').length,
      absent_days: attendance.filter(a => a.status === 'absent').length,
      total_working_hours: attendance.reduce((sum, a) => sum + (parseFloat(a.working_hours) || 0), 0).toFixed(2)
    };

    res.status(200).json({
      success: true,
      data: {
        attendance: parsedAttendance,
        summary
      }
    });

  } catch (error) {
    console.error('Error fetching attendance history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch attendance history', 
      error: error.message 
    });
  }
});

// ADMIN: Get all attendance for a specific date
// ADMIN: Get all attendance for a specific date (improved version)
router.get('/admin/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;

    // First, get all salespersons
    const [salespersons] = await db.query(
      `SELECT id, full_name, email_id as email, phone 
       FROM users 
       WHERE role = 'salesman' OR role = 'Salesman' OR role = 'SALESMAN'`
    );

    // Then get attendance records for the date
    const [attendance] = await db.query(
      `SELECT sa.* 
       FROM salesperson_attendance sa
       WHERE sa.date = ?`,
      [date]
    );

    // Create a map of attendance records by salesperson_id
    const attendanceMap = {};
    attendance.forEach(record => {
      attendanceMap[record.salesperson_id] = record;
    });

    // Combine salespersons with their attendance records
    const combinedData = salespersons.map(sp => {
      const attendanceRecord = attendanceMap[sp.id] || {};
      return {
        id: attendanceRecord.id || null,
        salesperson_id: sp.id,
        salesperson_name: sp.full_name,
        email: sp.email,
        phone: sp.phone,
        date: date,
        check_in_time: attendanceRecord.check_in_time || null,
        check_out_time: attendanceRecord.check_out_time || null,
        working_hours: attendanceRecord.working_hours || null,
        status: attendanceRecord.status || 'absent',
        check_in_location: attendanceRecord.check_in_location || null,
        check_out_location: attendanceRecord.check_out_location || null,
        check_in_photo: attendanceRecord.check_in_photo || null,
        check_out_photo: attendanceRecord.check_out_photo || null,
        check_in_remarks: attendanceRecord.check_in_remarks || null,
        check_out_remarks: attendanceRecord.check_out_remarks || null
      };
    });

    const summary = {
      total_salespersons: salespersons.length,
      present: combinedData.filter(a => a.status === 'present').length,
      late: combinedData.filter(a => a.status === 'late').length,
      half_day: combinedData.filter(a => a.status === 'half_day').length,
      absent: combinedData.filter(a => a.status === 'absent').length
    };

    res.status(200).json({
      success: true,
      data: {
        attendance: combinedData,
        summary
      }
    });

  } catch (error) {
    console.error('Error fetching daily attendance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch daily attendance', 
      error: error.message 
    });
  }
});

// ADMIN: Get monthly attendance report
router.get('/admin/monthly/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;

    const [attendance] = await db.query(
      `SELECT sa.*, u.email, u.phone, u.full_name as user_full_name 
       FROM salesperson_attendance sa
       JOIN users u ON sa.salesperson_id = u.id
       WHERE YEAR(sa.date) = ? AND MONTH(sa.date) = ?
       ORDER BY sa.date DESC, sa.salesperson_name ASC`,
      [year, month]
    );

    // Group by salesperson
    const groupedData = attendance.reduce((acc, record) => {
      if (!acc[record.salesperson_id]) {
        acc[record.salesperson_id] = {
          salesperson_id: record.salesperson_id,
          salesperson_name: record.salesperson_name,
          email: record.email,
          phone: record.phone,
          attendance: []
        };
      }
      acc[record.salesperson_id].attendance.push(record);
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      data: Object.values(groupedData)
    });

  } catch (error) {
    console.error('Error fetching monthly attendance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch monthly attendance', 
      error: error.message 
    });
  }
});

// ADMIN: Get attendance summary for date range
router.get('/admin/summary', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let query = `
      SELECT 
        DATE(date) as attendance_date,
        COUNT(DISTINCT salesperson_id) as total_salespersons,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late_count,
        SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_day_count,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_count,
        ROUND(AVG(working_hours), 2) as avg_working_hours
      FROM salesperson_attendance
      WHERE 1=1
    `;
    
    let params = [];
    
    if (start_date && end_date) {
      query += ' AND date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      query += ' AND date >= ?';
      params.push(start_date);
    } else if (end_date) {
      query += ' AND date <= ?';
      params.push(end_date);
    }
    
    query += ' GROUP BY DATE(date) ORDER BY date DESC';

    const [summary] = await db.query(query, params);

    res.status(200).json({
      success: true,
      data: summary
    });

  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch attendance summary', 
      error: error.message 
    });
  }
});

// GET attendance photo
router.get('/photos/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, '../uploads/attendance', filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: 'Photo not found' });
  }
});

// UPDATE attendance record (admin only)
router.put('/admin/update/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      status, 
      check_in_time, 
      check_out_time,
      working_hours,
      remarks 
    } = req.body;

    const [result] = await db.query(
      `UPDATE salesperson_attendance 
       SET status = COALESCE(?, status),
           check_in_time = COALESCE(?, check_in_time),
           check_out_time = COALESCE(?, check_out_time),
           working_hours = COALESCE(?, working_hours),
           check_in_remarks = COALESCE(?, check_in_remarks),
           check_out_remarks = COALESCE(?, check_out_remarks)
       WHERE id = ?`,
      [status, check_in_time, check_out_time, working_hours, remarks, remarks, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Attendance record updated successfully'
    });

  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update attendance', 
      error: error.message 
    });
  }
});

// DELETE attendance record (admin only)
router.delete('/admin/delete/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get photos before deletion
    const [[record]] = await db.query(
      'SELECT check_in_photo, check_out_photo FROM salesperson_attendance WHERE id = ?',
      [id]
    );

    const [result] = await db.query(
      'DELETE FROM salesperson_attendance WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    // Delete associated photos
    if (record) {
      [record.check_in_photo, record.check_out_photo].forEach(photo => {
        if (photo) {
          const filePath = path.join('uploads/attendance', photo);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Attendance record deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete attendance', 
      error: error.message 
    });
  }
});


// Add this new route to your attendanceRoutes.js file
// GEocode address from coordinates (proxy for OpenStreetMap)
router.get('/geocode', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
      return res.status(400).json({ 
        success: false, 
        message: 'Latitude and longitude are required' 
      });
    }

    // Make request to OpenStreetMap from server side (no CORS issues)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'YourAppName/1.0' // Replace with your app name
        }
      }
    );

    if (!response.ok) {
      throw new Error(`OpenStreetMap API responded with status: ${response.status}`);
    }

    const data = await response.json();
    
    res.status(200).json({
      success: true,
      data: {
        display_name: data.display_name || `Location: ${lat}, ${lon}`,
        address: data.address || {}
      }
    });

  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get address from coordinates',
      error: error.message 
    });
  }
});


// Serve uploaded photos statically
router.use('/uploads', express.static('uploads'));

module.exports = router;