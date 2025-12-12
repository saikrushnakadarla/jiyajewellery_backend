// routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer'); // Add this import

// Configure nodemailer (add this configuration)
const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: process.env.EMAIL_USER, // set these in your environment variables
    pass: process.env.EMAIL_PASS
  }
});

/**
 * Expected fields in request body (create / update):
 * full_name, email_id, date_of_birth, gender, designation,
 * date_of_anniversary, country, state, city,
 * password, confirm_password, company_name, role, status, pincode
 */

// Function to send email (add this function)
const sendStatusEmail = async (email, full_name, status, credentials = null) => {
  let subject, html;
  
  if (status === 'approved') {
    subject = 'Your Account Has Been Approved';
    html = `
      <h2>Account Approval Notification</h2>
      <p>Dear ${full_name},</p>
      <p>We are pleased to inform you that your account has been approved by our administration team.</p>
      <p>You can now access your account using the following credentials:</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Password:</strong> ${credentials.password}</p>
      <p>Please log in and change your password after your first login for security reasons.</p>
      <br>
      <p>Thank you,<br>Administration Team</p>
    `;
  } else if (status === 'rejected') {
    subject = 'Your Account Application Status';
    html = `
      <h2>Account Application Notification</h2>
      <p>Dear ${full_name},</p>
      <p>We regret to inform you that your account application has not been approved at this time.</p>
      <p>If you believe this is an error or would like more information, please contact our support team.</p>
      <br>
      <p>Thank you,<br>Administration Team</p>
    `;
  } else {
    return; // No email for other statuses
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: html
    });
    console.log(`Status email sent to ${email}`);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send status email');
  }
};

/* GET all users */
router.get('/api/users', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT id, full_name, email_id, phone, date_of_birth, gender, designation, 
             date_of_anniversary, country, state, city, 
             company_name, role, status, pincode 
      FROM users
    `);
    res.json(results);
  } catch (err) {
    console.error('GET /users error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* GET user by id */
router.get('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.query(`
      SELECT id, full_name, email_id, phone, date_of_birth, gender, designation, 
             date_of_anniversary, country, state, city, 
             company_name, role, status, pincode 
      FROM users WHERE id = ?
    `, [id]);

    if (results.length === 0) return res.status(404).json({ message: 'User not found' });
    res.json(results[0]);
  } catch (err) {
    console.error(`GET /users/${id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

/* CREATE new user */
router.post('/api/users', async (req, res) => {
  try {
    const {
      full_name,
      email_id,
      phone,
      date_of_birth,
      gender,
      designation,
      date_of_anniversary,
      country,
      state,
      city,
      password,
      confirm_password,
      company_name,
      role,
      status,
      pincode
    } = req.body;

    // Basic validations
    if (!email_id || !password) {
      return res.status(400).json({ message: 'email_id and password are required' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ message: 'Password and confirm_password do not match' });
    }

    // Check if email already exists
    const [existing] = await db.query('SELECT id FROM users WHERE email_id = ?', [email_id]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const insertQuery = `
      INSERT INTO users (
        full_name, email_id, phone, date_of_birth, gender, designation,
        date_of_anniversary, country, state, city,
        password, confirm_password, company_name, role, status, pincode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.query(insertQuery, [
      full_name || null,
      email_id,
      phone || null,
      date_of_birth || null,
      gender || null,
      designation || null,
      date_of_anniversary || null,
      country || null,
      state || null,
      city || null,
      password, // store as plain text (for now)
      confirm_password,
      company_name || null,
      role || null,
      status || null,
      pincode || null
    ]);

    res.status(201).json({
      id: result.insertId,
      message: 'User created successfully',
      email_id
    });

  } catch (err) {
    console.error('POST /users error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* UPDATE user - Modified to send email on status change */
router.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const {
      full_name,
      email_id,
      phone,
      date_of_birth,
      gender,
      designation,
      date_of_anniversary,
      country,
      state,
      city,
      password,
      confirm_password,
      company_name,
      role,
      status,
      pincode
    } = req.body;

    // If updating password, ensure confirm matches
    if (password || confirm_password) {
      if (password !== confirm_password) {
        return res.status(400).json({ message: 'Password and confirm_password do not match' });
      }
    }

    // Get current user data to check if status is changing
    const [currentUser] = await db.query(
      'SELECT status, full_name, email_id, password FROM users WHERE id = ?', 
      [id]
    );
    
    if (currentUser.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const oldStatus = currentUser[0]?.status;
    const userName = currentUser[0]?.full_name;
    const userEmail = currentUser[0]?.email_id;
    const userPassword = currentUser[0]?.password;

    // Build update query dynamically (so missing fields are not overwritten)
    const updates = [];
    const params = [];

    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (email_id !== undefined) { updates.push('email_id = ?'); params.push(email_id); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (date_of_birth !== undefined) { updates.push('date_of_birth = ?'); params.push(date_of_birth); }
    if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
    if (designation !== undefined) { updates.push('designation = ?'); params.push(designation); }
    if (date_of_anniversary !== undefined) { updates.push('date_of_anniversary = ?'); params.push(date_of_anniversary); }
    if (country !== undefined) { updates.push('country = ?'); params.push(country); }
    if (state !== undefined) { updates.push('state = ?'); params.push(state); }
    if (city !== undefined) { updates.push('city = ?'); params.push(city); }
    if (password !== undefined) { updates.push('password = ?'); params.push(password); }
    if (confirm_password !== undefined) { updates.push('confirm_password = ?'); params.push(confirm_password); }
    if (company_name !== undefined) { updates.push('company_name = ?'); params.push(company_name); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);

    await db.query(query, params);

    // Send email if status changed to approved or rejected
    if (status !== undefined && status !== oldStatus && 
        (status === 'approved' || status === 'rejected')) {
      try {
        // For approved status, include credentials in email
        let credentials = null;
        if (status === 'approved') {
          // Get the password (either new one or existing)
          const passwordToSend = password || userPassword;
          credentials = { password: passwordToSend };
        }
        
        await sendStatusEmail(userEmail, userName, status, credentials);
      } catch (emailError) {
        console.error('Error sending status email:', emailError);
        // Don't fail the request if email fails
      }
    }

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error(`PUT /users/${id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

/* DELETE user */
router.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(`DELETE /users/${id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

/* LOGIN (match by email_id and password) */
router.post('/api/users/login', async (req, res) => {
  try {
    const { email_id, password } = req.body;
    if (!email_id || !password) {
      return res.status(400).json({ message: 'email_id and password are required' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email_id = ?', [email_id]);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email_id or password' });
    }

    const user = rows[0];

    // Compare plain text password (since stored as plain text here)
    if (password !== user.password) {
      return res.status(401).json({ message: 'Invalid email_id or password' });
    }

    // Optionally update last_login_date
    try {
      await db.query('UPDATE users SET last_login_date = NOW() WHERE id = ?', [user.id]);
    } catch (e) {
      // ignore
    }

    // Remove sensitive fields
    const safeUser = { ...user };
    delete safeUser.password;
    delete safeUser.confirm_password;

    res.json({
      message: 'Login successful',
      user: safeUser
    });

  } catch (err) {
    console.error('POST /users/login error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;