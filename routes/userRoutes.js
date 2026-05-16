// routes/users.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Function to generate next customer ID
async function generateCustomerId() {
  try {
    // Get the latest customer_id from users table (only for role = 'customer')
    const [rows] = await db.query(
      "SELECT customer_id FROM users WHERE role = 'customer' AND customer_id IS NOT NULL ORDER BY id DESC LIMIT 1"
    );
    
    let nextNumber = 1;
    if (rows.length > 0 && rows[0].customer_id) {
      const match = rows[0].customer_id.match(/CUST-(\d+)/);
      if (match) {
        nextNumber = parseInt(match[1]) + 1;
      }
    }
    
    // Format with leading zeros (CUST-001, CUST-002, etc.)
    return `CUST-${String(nextNumber).padStart(3, '0')}`;
  } catch (error) {
    console.error('Error generating customer ID:', error);
    return `CUST-${Date.now()}`;
  }
}

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

// Configure multer for profile photo uploads
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/profiles';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = function (req, file, cb) {
  const filetypes = /jpeg|jpg|png|gif|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'));
  }
};

const uploadFace = multer({
  storage: faceStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

const uploadProfile = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: fileFilter
});

// Configure nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate OTP (6-digit)
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store OTPs temporarily
const otpStore = new Map();

// Clean up expired OTPs every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (value.expiresAt < now) {
      otpStore.delete(key);
    }
  }
}, 3600000);

// Function to send OTP email
const sendOTPEmail = async (email, full_name, otp) => {
  const subject = 'Email Verification - OTP Code';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Email Verification</h2>
      <p>Dear ${full_name},</p>
      <p>Thank you for registering with us. Please use the following OTP to verify your email address:</p>
      <div style="text-align: center; margin: 30px 0;">
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4F46E5; padding: 15px; background: #f3f4f6; border-radius: 8px; display: inline-block;">
          ${otp}
        </div>
      </div>
      <p>This OTP is valid for 10 minutes.</p>
      <p>If you didn't request this verification, please ignore this email.</p>
      <br>
      <p>Best regards,<br>Jiyaa Jewels Team</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: html
    });
    console.log(`OTP email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    throw new Error('Failed to send OTP email');
  }
};

// Function to send status email
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
      <p><strong>Note:</strong> Upon your first login, you will be required to verify your email address.</p>
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
    return;
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
             date_of_anniversary, country, state, city, district,
             company_name, role, status, email_verified, pincode, face_photo_path, 
             profile_photo_path, latitude, longitude, customer_id
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
             date_of_anniversary, country, state, city, district,
             company_name, role, status, email_verified, pincode, face_photo_path, 
             profile_photo_path, latitude, longitude, customer_id
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
router.post('/api/users', 
  uploadFace.fields([
    { name: 'face_photo', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 }
  ]), 
  async (req, res) => {
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
      district,
      password,
      confirm_password,
      company_name,
      role,
      status,
      pincode,
      face_descriptor,
      latitude,
      longitude
    } = req.body;

    if (!email_id || !password) {
      return res.status(400).json({ message: 'email_id and password are required' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ message: 'Password and confirm_password do not match' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE email_id = ?', [email_id]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    if (role === 'salesman') {
      if (!req.files || !req.files.profile_photo || req.files.profile_photo.length === 0) {
        return res.status(400).json({ 
          message: 'Profile photo is mandatory for salesman registration' 
        });
      }
    }

    const facePhotoPath = req.files && req.files.face_photo && req.files.face_photo.length > 0 
      ? req.files.face_photo[0].filename 
      : null;
    
    const profilePhotoPath = req.files && req.files.profile_photo && req.files.profile_photo.length > 0 
      ? req.files.profile_photo[0].filename 
      : null;

    // Generate customer_id only for role = 'customer'
    let customerId = null;
    if (role === 'customer') {
      customerId = await generateCustomerId();
    }

    const insertQuery = `
      INSERT INTO users (
        full_name, email_id, phone, date_of_birth, gender, designation,
        date_of_anniversary, country, state, city, district,
        password, confirm_password, company_name, role, status, email_verified, pincode,
        face_descriptor, face_photo_path, profile_photo_path, latitude, longitude, customer_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      district || null,
      password,
      confirm_password,
      company_name || null,
      role || null,
      status || null,
      'Not Verified',
      pincode || null,
      face_descriptor || null,
      facePhotoPath,
      profilePhotoPath,
      latitude || null,
      longitude || null,
      customerId
    ]);

    res.status(201).json({
      id: result.insertId,
      message: 'User created successfully',
      email_id,
      face_photo: facePhotoPath,
      profile_photo: profilePhotoPath,
      customer_id: customerId
    });

  } catch (err) {
    console.error('POST /users error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* UPDATE user */
router.put('/api/users/:id', 
  uploadFace.fields([
    { name: 'face_photo', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 }
  ]), 
  async (req, res) => {
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
      district,
      password,
      confirm_password,
      company_name,
      role,
      status,
      email_verified,
      pincode,
      face_descriptor,
      latitude,
      longitude
    } = req.body;

    if (password || confirm_password) {
      if (password !== confirm_password) {
        return res.status(400).json({ message: 'Password and confirm_password do not match' });
      }
    }

    const [currentUser] = await db.query(
      'SELECT status, full_name, email_id, password, email_verified, face_photo_path, profile_photo_path FROM users WHERE id = ?', 
      [id]
    );
    
    if (currentUser.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const oldStatus = currentUser[0]?.status;
    const userName = currentUser[0]?.full_name;
    const userEmail = currentUser[0]?.email_id;
    const userPassword = currentUser[0]?.password;

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
    if (district !== undefined) { updates.push('district = ?'); params.push(district); }
    if (password !== undefined) { updates.push('password = ?'); params.push(password); }
    if (confirm_password !== undefined) { updates.push('confirm_password = ?'); params.push(confirm_password); }
    if (company_name !== undefined) { updates.push('company_name = ?'); params.push(company_name); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (email_verified !== undefined) { updates.push('email_verified = ?'); params.push(email_verified); }
    if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }
    if (face_descriptor !== undefined) { updates.push('face_descriptor = ?'); params.push(face_descriptor); }
    if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
    
    if (req.files && req.files.face_photo && req.files.face_photo.length > 0) {
      if (currentUser[0]?.face_photo_path) {
        const oldPath = path.join('uploads/faces', currentUser[0].face_photo_path);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      updates.push('face_photo_path = ?');
      params.push(req.files.face_photo[0].filename);
    }

    if (req.files && req.files.profile_photo && req.files.profile_photo.length > 0) {
      if (currentUser[0]?.profile_photo_path) {
        const oldPath = path.join('uploads/profiles', currentUser[0].profile_photo_path);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      updates.push('profile_photo_path = ?');
      params.push(req.files.profile_photo[0].filename);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields provided to update' });
    }

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);

    await db.query(query, params);

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

/* Send OTP for email verification */
router.post('/api/users/send-otp/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const [users] = await db.query(
      'SELECT id, full_name, email_id, email_verified, status FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    if (user.status !== 'approved') {
      return res.status(403).json({ message: 'Account not approved yet' });
    }

    if (user.email_verified === 'Verified') {
      return res.status(400).json({ message: 'Email already verified' });
    }

    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    otpStore.set(user.email_id, {
      otp,
      expiresAt,
      attempts: 0
    });

    await sendOTPEmail(user.email_id, user.full_name, otp);

    res.json({ 
      success: true, 
      message: 'OTP sent to your email address',
      email: user.email_id
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* Verify OTP */
router.post('/api/users/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  try {
    const storedData = otpStore.get(email);

    if (!storedData) {
      return res.status(400).json({ message: 'OTP expired or not found. Please request a new OTP.' });
    }

    if (storedData.expiresAt < Date.now()) {
      otpStore.delete(email);
      return res.status(400).json({ message: 'OTP has expired. Please request a new OTP.' });
    }

    if (storedData.attempts >= 3) {
      otpStore.delete(email);
      return res.status(400).json({ message: 'Too many failed attempts. Please request a new OTP.' });
    }

    if (storedData.otp !== otp) {
      storedData.attempts++;
      otpStore.set(email, storedData);
      return res.status(400).json({ message: 'Invalid OTP. Please try again.' });
    }

    const [result] = await db.query(
      'UPDATE users SET email_verified = "Verified" WHERE email_id = ?',
      [email]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    otpStore.delete(email);

    res.json({ 
      success: true, 
      message: 'Email verified successfully!'
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* Check email verification status */
router.get('/api/users/check-verification/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const [users] = await db.query(
      'SELECT email_verified, status FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = users[0];

    res.json({
      email_verified: user.email_verified,
      status: user.status,
      needs_verification: user.status === 'approved' && user.email_verified === 'Not Verified'
    });

  } catch (error) {
    console.error('Check verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* DELETE user */
router.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [user] = await db.query('SELECT face_photo_path, profile_photo_path FROM users WHERE id = ?', [id]);
    
    if (user[0]?.face_photo_path) {
      const facePath = path.join('uploads/faces', user[0].face_photo_path);
      if (fs.existsSync(facePath)) {
        fs.unlinkSync(facePath);
      }
    }
    
    if (user[0]?.profile_photo_path) {
      const profilePath = path.join('uploads/profiles', user[0].profile_photo_path);
      if (fs.existsSync(profilePath)) {
        fs.unlinkSync(profilePath);
      }
    }
    
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(`DELETE /users/${id} error:`, err);
    res.status(500).json({ error: err.message });
  }
});

/* LOGIN */
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

router.post('/api/users/face-login', async (req, res) => {
  try {
    const { face_descriptor } = req.body;
    
    if (!face_descriptor) {
      return res.status(400).json({ message: 'Face descriptor is required' });
    }

    const [users] = await db.query(
      'SELECT id, full_name, email_id, role, status, email_verified, face_descriptor FROM users WHERE face_descriptor IS NOT NULL AND role != "admin"'
    );

    if (users.length === 0) {
      return res.status(404).json({ message: 'No registered faces found' });
    }

    let inputDescriptor;
    try {
      inputDescriptor = JSON.parse(face_descriptor);
    } catch (e) {
      return res.status(400).json({ message: 'Invalid face descriptor format' });
    }

    let bestMatch = null;
    let bestDistance = Infinity;
    const threshold = 0.6;

    for (const user of users) {
      if (!user.face_descriptor) continue;
      
      let storedDescriptor;
      try {
        storedDescriptor = JSON.parse(user.face_descriptor);
      } catch (e) {
        continue;
      }

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

    if (bestMatch && bestDistance <= threshold) {
      const safeUser = {
        id: bestMatch.id,
        full_name: bestMatch.full_name,
        email_id: bestMatch.email_id,
        role: bestMatch.role,
        status: bestMatch.status,
        email_verified: bestMatch.email_verified
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

// Serve profile photos
router.get('/api/users/profile-photo/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, '../uploads/profiles', filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: 'Photo not found' });
  }
});

module.exports = router;