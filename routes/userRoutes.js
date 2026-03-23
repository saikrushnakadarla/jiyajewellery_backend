// routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer'); // Add this import

const multer = require('multer');
const path = require('path');
const fs = require('fs');



// Configure multer for face photo uploads
const faceStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/faces';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'face-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadFace = multer({
  storage: faceStorage,
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
             company_name, role, status, pincode , face_photo_path
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
router.post('/api/users', uploadFace.single('face_photo'), async (req, res) => {
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
      pincode,
      face_descriptor
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

    const facePhotoPath = req.file ? req.file.filename : null;

    const insertQuery = `
      INSERT INTO users (
        full_name, email_id, phone, date_of_birth, gender, designation,
        date_of_anniversary, country, state, city,
        password, confirm_password, company_name, role, status, pincode,
        face_descriptor, face_photo_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      password,
      confirm_password,
      company_name || null,
      role || null,
      status || null,
      pincode || null,
      face_descriptor || null,
      facePhotoPath
    ]);

    res.status(201).json({
      id: result.insertId,
      message: 'User created successfully',
      email_id,
      face_photo: facePhotoPath
    });

  } catch (err) {
    console.error('POST /users error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* UPDATE user - Modified to send email on status change */
router.put('/api/users/:id', uploadFace.single('face_photo'), async (req, res) => {
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
      pincode,
      face_descriptor
    } = req.body;

    // If updating password, ensure confirm matches
    if (password || confirm_password) {
      if (password !== confirm_password) {
        return res.status(400).json({ message: 'Password and confirm_password do not match' });
      }
    }

    // Get current user data
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

    // Build update query dynamically
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
    if (face_descriptor !== undefined) { updates.push('face_descriptor = ?'); params.push(face_descriptor); }
    
    if (req.file) {
      // Delete old photo if exists
      const [oldPhoto] = await db.query('SELECT face_photo_path FROM users WHERE id = ?', [id]);
      if (oldPhoto[0]?.face_photo_path) {
        const oldPath = path.join('uploads/faces', oldPhoto[0].face_photo_path);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      updates.push('face_photo_path = ?');
      params.push(req.file.filename);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);

    await db.query(query, params);

    // Send email if status changed
    if (status !== undefined && status !== oldStatus && 
        (status === 'approved' || status === 'rejected')) {
      try {
        let credentials = null;
        if (status === 'approved') {
          const passwordToSend = password || userPassword;
          credentials = { password: passwordToSend };
        }
        await sendStatusEmail(userEmail, userName, status, credentials);
      } catch (emailError) {
        console.error('Error sending status email:', emailError);
      }
    }

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error(`PUT /users/${id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});


router.post('/api/users/face-login', async (req, res) => {
  try {
    const { face_descriptor } = req.body;
    
    if (!face_descriptor) {
      return res.status(400).json({ message: 'Face descriptor is required' });
    }

    // Get all users with face descriptors
    const [users] = await db.query(
      'SELECT id, full_name, email_id, role, status, face_descriptor FROM users WHERE face_descriptor IS NOT NULL AND role != "admin"'
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'No registered faces found' });
    }

    // Parse the incoming face descriptor
    let inputDescriptor;
    try {
      inputDescriptor = JSON.parse(face_descriptor);
    } catch (e) {
      return res.status(400).json({ message: 'Invalid face descriptor format' });
    }

    // Find best match
    let bestMatch = null;
    let bestDistance = Infinity;
    const threshold = 0.6; // Lower threshold = stricter matching

    for (const user of users) {
      if (!user.face_descriptor) continue;
      
      let storedDescriptor;
      try {
        storedDescriptor = JSON.parse(user.face_descriptor);
      } catch (e) {
        continue;
      }

      // Calculate Euclidean distance between descriptors
      let distance = 0;
      for (let i = 0; i < inputDescriptor.length; i++) {
        distance += Math.pow(inputDescriptor[i] - storedDescriptor[i], 2);
      }
      distance = Math.sqrt(distance);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = user;
      }
    }

    // Check if match is within threshold
    if (bestMatch && bestDistance <= threshold) {
      // Remove sensitive fields
      const safeUser = {
        id: bestMatch.id,
        full_name: bestMatch.full_name,
        email_id: bestMatch.email_id,
        role: bestMatch.role,
        status: bestMatch.status
      };
      
      res.json({
        success: true,
        message: 'Face login successful',
        user: safeUser,
        match_score: (1 - bestDistance).toFixed(4)
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: 'Face not recognized',
        match_score: bestMatch ? (1 - bestDistance).toFixed(4) : 0
      });
    }

  } catch (err) {
    console.error('POST /users/face-login error:', err);
    res.status(500).json({ error: err.message });
  }
});



/* DELETE user */
router.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Get face photo before deletion
    const [user] = await db.query('SELECT face_photo_path FROM users WHERE id = ?', [id]);
    if (user[0]?.face_photo_path) {
      const photoPath = path.join('uploads/faces', user[0].face_photo_path);
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    }
    
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(`DELETE /users/${id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

/* LOGIN (match by email_id and password) */
/* LOGIN (match by email_id OR phone number) */
/* LOGIN (match by email_id OR phone number) */
router.post('/api/users/login', async (req, res) => {
  try {
    const { email_id, password } = req.body;
    if (!email_id || !password) {
      return res.status(400).json({ message: 'email_id/phone and password are required' });
    }

    const isEmail = email_id.includes('@');
    let query;
    let queryParams;

    if (isEmail) {
      query = 'SELECT * FROM users WHERE email_id = ?';
      queryParams = [email_id];
    } else {
      query = 'SELECT * FROM users WHERE phone = ?';
      queryParams = [email_id];
    }

    const [rows] = await db.query(query, queryParams);

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email/phone or password' });
    }

    const user = rows[0];

    if (password !== user.password) {
      return res.status(401).json({ message: 'Invalid email/phone or password' });
    }

    try {
      await db.query('UPDATE users SET last_login_date = NOW() WHERE id = ?', [user.id]);
    } catch (e) {
      // ignore
    }

    const safeUser = { ...user };
    delete safeUser.password;
    delete safeUser.confirm_password;
    delete safeUser.face_descriptor;

    res.json({
      message: 'Login successful',
      user: safeUser
    });

  } catch (err) {
    console.error('POST /users/login error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Serve face photos
router.get('/api/users/face-photo/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, '../uploads/faces', filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: 'Photo not found' });
  }
});

module.exports = router;