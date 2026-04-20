const express = require("express");
const db = require("../db"); // mysql2/promise pool
const router = express.Router();
const nodemailer = require('nodemailer');

// Email configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
};

// Send OTP via email
const sendOTPEmail = async (email, customerName, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER || 'your-email@gmail.com',
    to: email,
    subject: 'Visit Log OTP Verification',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #a36e29;">Visit Log OTP Verification</h2>
        <p>Dear ${customerName},</p>
        <p>Your OTP for visit log verification is:</p>
        <h1 style="color: #a36e29; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
        <p>This OTP is valid for 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <br>
        <p>Regards,<br>Sadashri Jewels Team</p>
      </div>
    `
  };

  return await transporter.sendMail(mailOptions);
};

// Get all customers (for dropdown) - Updated to include location data
router.get("/customers", async (req, res) => {
  try {
    console.log("Fetching all customers with location data...");
    const [results] = await db.query(
      `SELECT id, full_name, email_id as email, phone, role, status, 
              latitude, longitude 
       FROM users 
       WHERE role = 'Customer' AND status = 'approved' 
       ORDER BY full_name`
    );
    console.log(`Found ${results.length} customers`);
    res.json(results);
  } catch (err) {
    console.error("Error fetching customers:", err);
    res.status(500).json({ message: "Failed to fetch customers", error: err.message });
  }
});

// Get customer by ID - Updated to include location data
router.get("/customer/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [results] = await db.query(
      `SELECT id, full_name, email_id as email, phone, latitude, longitude 
       FROM users WHERE id = ?`,
      [id]
    );
    
    if (results.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }
    
    res.json(results[0]);
  } catch (err) {
    console.error("Error fetching customer:", err);
    res.status(500).json({ message: "Failed to fetch customer", error: err.message });
  }
});

// Send OTP to customer
router.post("/send-otp", async (req, res) => {
  try {
    const { customer_id, customer_name, email } = req.body;
    
    if (!customer_id || !customer_name || !email) {
      return res.status(400).json({ message: "Customer ID, name, and email are required" });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    console.log(`Generated OTP for customer ${customer_name}: ${otp}`);

    // Send OTP via email
    await sendOTPEmail(email, customer_name, otp);

    // For development/testing, return OTP (remove in production)
    res.json({ 
      success: true, 
      message: "OTP sent successfully",
      otp: otp, // Remove this in production
      expires_at: otpExpiry
    });

  } catch (err) {
    console.error("Error sending OTP:", err);
    res.status(500).json({ message: "Failed to send OTP", error: err.message });
  }
});

// Verify OTP and save visit log - Updated to include location data
router.post("/save-visit-log", async (req, res) => {
  try {
    const { 
      customer_id, 
      customer_name, 
      visit_date, 
      outcome, 
      notes, 
      otp, 
      salesperson_id, 
      source_by,
      salesperson_latitude,
      salesperson_longitude,
      customer_latitude,
      customer_longitude,
      distance_meters,
      location_verified
    } = req.body;

    // Validate required fields
    if (!customer_id || !customer_name || !visit_date || !outcome || !otp || !salesperson_id) {
      return res.status(400).json({ 
        message: "Missing required fields: customer_id, customer_name, visit_date, outcome, otp, salesperson_id are required" 
      });
    }

    // Insert visit log with location data
    const insertSql = `
      INSERT INTO visit_logs (
        customer_id, customer_name, visit_date, outcome, notes, otp, 
        otp_sent_at, otp_verified, otp_verified_at, salesperson_id, source_by,
        salesperson_latitude, salesperson_longitude, customer_latitude, customer_longitude,
        distance_meters, location_verified
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), TRUE, NOW(), ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.query(insertSql, [
      customer_id,
      customer_name,
      visit_date,
      outcome,
      notes || null,
      otp,
      salesperson_id,
      source_by || null,
      salesperson_latitude || null,
      salesperson_longitude || null,
      customer_latitude || null,
      customer_longitude || null,
      distance_meters || null,
      location_verified ? 1 : 0
    ]);

    res.status(201).json({ 
      success: true, 
      message: "Visit log saved successfully",
      visit_id: result.insertId
    });

  } catch (err) {
    console.error("Error saving visit log:", err);
    res.status(500).json({ message: "Failed to save visit log", error: err.message });
  }
});

// Get visit logs for a salesperson - Updated to include location data
router.get("/salesperson/:salesperson_id", async (req, res) => {
  try {
    const { salesperson_id } = req.params;
    
    const [results] = await db.query(
      `SELECT * FROM visit_logs 
       WHERE salesperson_id = ? 
       ORDER BY visit_date DESC, created_at DESC`,
      [salesperson_id]
    );
    
    res.json(results);
  } catch (err) {
    console.error("Error fetching visit logs:", err);
    res.status(500).json({ message: "Failed to fetch visit logs", error: err.message });
  }
});

// Get all visit logs (for admin)
router.get("/all", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM visit_logs ORDER BY visit_date DESC, created_at DESC"
    );
    res.json(results);
  } catch (err) {
    console.error("Error fetching all visit logs:", err);
    res.status(500).json({ message: "Failed to fetch visit logs", error: err.message });
  }
});

// Get visit logs by date range
router.post("/by-date-range", async (req, res) => {
  try {
    const { start_date, end_date, salesperson_id } = req.body;
    
    let query = "SELECT * FROM visit_logs WHERE visit_date BETWEEN ? AND ?";
    const params = [start_date, end_date];
    
    if (salesperson_id) {
      query += " AND salesperson_id = ?";
      params.push(salesperson_id);
    }
    
    query += " ORDER BY visit_date DESC, created_at DESC";
    
    const [results] = await db.query(query, params);
    res.json(results);
  } catch (err) {
    console.error("Error fetching visit logs by date range:", err);
    res.status(500).json({ message: "Failed to fetch visit logs", error: err.message });
  }
});

// Update visit log
router.put("/update/:visit_id", async (req, res) => {
  try {
    const { visit_id } = req.params;
    const { outcome, notes } = req.body;
    
    const [result] = await db.query(
      "UPDATE visit_logs SET outcome = ?, notes = ?, updated_at = NOW() WHERE visit_id = ?",
      [outcome, notes, visit_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Visit log not found" });
    }
    
    res.json({ success: true, message: "Visit log updated successfully" });
  } catch (err) {
    console.error("Error updating visit log:", err);
    res.status(500).json({ message: "Failed to update visit log", error: err.message });
  }
});

// Delete visit log
router.delete("/delete/:visit_id", async (req, res) => {
  try {
    const { visit_id } = req.params;
    
    const [result] = await db.query("DELETE FROM visit_logs WHERE visit_id = ?", [visit_id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Visit log not found" });
    }
    
    res.json({ success: true, message: "Visit log deleted successfully" });
  } catch (err) {
    console.error("Error deleting visit log:", err);
    res.status(500).json({ message: "Failed to delete visit log", error: err.message });
  }
});

// Get visit log statistics
router.get("/statistics/:salesperson_id", async (req, res) => {
  try {
    const { salesperson_id } = req.params;
    const { start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        COUNT(*) as total_visits,
        SUM(CASE WHEN outcome = 'Interested' THEN 1 ELSE 0 END) as interested_count,
        SUM(CASE WHEN outcome = 'Not Interested' THEN 1 ELSE 0 END) as not_interested_count,
        SUM(CASE WHEN outcome = 'Follow Up' THEN 1 ELSE 0 END) as follow_up_count,
        SUM(CASE WHEN outcome = 'Converted' THEN 1 ELSE 0 END) as converted_count,
        SUM(CASE WHEN outcome = 'Other' THEN 1 ELSE 0 END) as other_count,
        COUNT(DISTINCT customer_id) as unique_customers
      FROM visit_logs 
      WHERE salesperson_id = ?
    `;
    
    const params = [salesperson_id];
    
    if (start_date && end_date) {
      query += " AND visit_date BETWEEN ? AND ?";
      params.push(start_date, end_date);
    }
    
    const [results] = await db.query(query, params);
    res.json(results[0]);
  } catch (err) {
    console.error("Error fetching visit log statistics:", err);
    res.status(500).json({ message: "Failed to fetch statistics", error: err.message });
  }
});

// Get today's visit logs status for a salesperson
router.get("/today-status/:salespersonId", async (req, res) => {
  try {
    const { salespersonId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    const [rows] = await db.query(
      'SELECT COUNT(*) as count FROM visit_logs WHERE salesperson_id = ? AND DATE(visit_date) = ?',
      [salespersonId, today]
    );
    
    res.json({
      success: true,
      hasLogs: rows[0].count > 0
    });
  } catch (error) {
    console.error('Error checking today\'s visit logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Geocode endpoint (for reverse geocoding)
router.get("/geocode", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    
    if (!lat || !lon) {
      return res.status(400).json({ success: false, message: "Latitude and longitude are required" });
    }

    const axios = require('axios');
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat: lat,
        lon: lon,
        format: 'json',
        addressdetails: 1,
        zoom: 18
      },
      headers: {
        'User-Agent': 'SadashriJewels/1.0'
      },
      timeout: 5000
    });

    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Geocoding error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get address',
      error: error.message 
    });
  }
});

module.exports = router;