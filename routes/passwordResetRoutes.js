// routes/passwordResetRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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

// Clean up expired OTPs (run every hour)
const cleanupExpiredOTPs = async () => {
  try {
    const [result] = await db.query(
      'DELETE FROM password_resets WHERE expires_at < NOW() OR is_used = TRUE'
    );
    if (result.affectedRows > 0) {
      console.log(`Cleaned up ${result.affectedRows} expired/used OTPs`);
    }
  } catch (error) {
    console.error('Error cleaning up OTPs:', error);
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredOTPs, 3600000);

// Function to send password reset OTP email
const sendPasswordResetEmail = async (email, full_name, otp) => {
  const subject = 'Password Reset Request - OTP Code';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Password Reset Request</h2>
      <p>Dear ${full_name},</p>
      <p>We received a request to reset your password. Please use the following OTP to reset your password:</p>
      <div style="text-align: center; margin: 30px 0;">
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4F46E5; padding: 15px; background: #f3f4f6; border-radius: 8px; display: inline-block;">
          ${otp}
        </div>
      </div>
      <p>This OTP is valid for 10 minutes.</p>
      <p>If you didn't request this password reset, please ignore this email or contact support.</p>
      <br>
      <p>Best regards,<br>Jiyaa Jewels Team</p>
      <hr>
      <p style="font-size: 12px; color: #666;">For security reasons, never share this OTP with anyone.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: html
    });
    console.log(`Password reset OTP email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    throw new Error('Failed to send OTP email');
  }
};

// Function to send password change confirmation email
const sendPasswordChangeConfirmation = async (email, full_name) => {
  const subject = 'Password Changed Successfully';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
      <h2 style="color: #333; text-align: center;">Password Changed Successfully</h2>
      <p>Dear ${full_name},</p>
      <p>Your password has been successfully changed.</p>
      <p>If you did not make this change, please contact our support team immediately.</p>
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
    console.log(`Password change confirmation sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Error sending confirmation email:', error);
  }
};

/* ==================== FORGOT PASSWORD ROUTES ==================== */

/**
 * POST /api/users/forgot-password
 * Send OTP to user's email for password reset
 */
router.post('/api/users/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email address is required' 
      });
    }

    // Check if user exists with this email
    const [users] = await db.query(
      'SELECT id, full_name, email_id, role, status FROM users WHERE email_id = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No account found with this email address' 
      });
    }

    const user = users[0];

    // Check if account is approved (for customers)
    if (user.role === 'customer' && user.status !== 'approved') {
      return res.status(403).json({ 
        success: false, 
        message: 'Your account is pending approval. Please wait for admin approval.' 
      });
    }

    // Check if account is active (for salesman)
    if (user.role === 'salesman') {
      const [accountStatus] = await db.query(
        'SELECT account_status FROM users WHERE id = ?',
        [user.id]
      );
      if (accountStatus[0]?.account_status === 'inactive') {
        return res.status(403).json({ 
          success: false, 
          message: 'Your account is blocked. Please contact administrator.' 
        });
      }
    }

    // Delete any existing unused OTPs for this email
    await db.query(
      'DELETE FROM password_resets WHERE email_id = ? AND is_used = FALSE',
      [email]
    );

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Store OTP in database
    await db.query(
      'INSERT INTO password_resets (email_id, otp, expires_at, attempts) VALUES (?, ?, ?, ?)',
      [email, otp, expiresAt, 0]
    );

    // Send OTP email
    await sendPasswordResetEmail(email, user.full_name, otp);

    res.json({ 
      success: true, 
      message: 'Verification code sent to your email address'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send verification code. Please try again later.' 
    });
  }
});


router.post('/api/users/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log("VERIFY REQUEST");
    console.log("Email:", email);
    console.log("OTP:", otp);

    const [records] = await db.query(
      `SELECT * FROM password_resets 
       WHERE email_id = ?
       ORDER BY created_at DESC`,
      [email]
    );

    console.log("DATABASE RECORDS:", records);

    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No OTP found for this email"
      });
    }

    const record = records[0];

    console.log("DB OTP:", record.otp);
    console.log("Entered OTP:", otp);
    console.log("Expires:", record.expires_at);
    console.log("Current:", new Date());

    if (record.is_used) {
      return res.status(400).json({
        success: false,
        message: "OTP already used"
      });
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    if (String(record.otp).trim() !== String(otp).trim()) {
      return res.status(400).json({
        success: false,
        message: "OTP does not match"
      });
    }

    await db.query(
      "UPDATE password_resets SET is_used = 1 WHERE id = ?",
      [record.id]
    );

    return res.json({
      success: true,
      message: "OTP verified successfully"
    });

  } catch (error) {
    console.log("VERIFY ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});


router.post('/api/users/resend-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email address is required' 
      });
    }

    // Check if user exists
    const [users] = await db.query(
      'SELECT id, full_name, email_id FROM users WHERE email_id = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No account found with this email address' 
      });
    }

    const user = users[0];

    // Delete existing unused OTPs
    await db.query(
      'DELETE FROM password_resets WHERE email_id = ? AND is_used = FALSE',
      [email]
    );

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Store new OTP
    await db.query(
      'INSERT INTO password_resets (email_id, otp, expires_at, attempts) VALUES (?, ?, ?, ?)',
      [email, otp, expiresAt, 0]
    );

    // Send OTP email
    await sendPasswordResetEmail(email, user.full_name, otp);

    res.json({ 
      success: true, 
      message: 'New verification code sent to your email address'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resend verification code. Please try again.' 
    });
  }
});


router.post('/api/users/reset-password', async (req, res) => {
  try {
    const { email, new_password, confirm_password, reset_token } = req.body;

    if (!email || !new_password || !confirm_password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, new password, and confirm password are required' 
      });
    }

    // Validate password strength
    if (new_password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password must be at least 6 characters long' 
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Passwords do not match' 
      });
    }

    // Get user with reset token validation
    let query = 'SELECT id, full_name, email_id, reset_token, reset_token_expires FROM users WHERE email_id = ?';
    let params = [email];

    if (reset_token) {
      query += ' AND reset_token = ?';
      params.push(reset_token);
    }

    const [users] = await db.query(query, params);

    if (users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Invalid reset request. Please restart the password reset process.' 
      });
    }

    const user = users[0];

    // Check if reset token is still valid (if token was used)
    if (reset_token && user.reset_token_expires) {
      if (new Date(user.reset_token_expires) < new Date()) {
        return res.status(400).json({ 
          success: false, 
          message: 'Reset token has expired. Please request a new verification code.' 
        });
      }
    }

    // Update password
    await db.query(
      'UPDATE users SET password = ?, confirm_password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [new_password, new_password, user.id]
    );

    // Send confirmation email
    await sendPasswordChangeConfirmation(email, user.full_name);

    // Clean up all reset requests for this email
    await db.query('DELETE FROM password_resets WHERE email_id = ?', [email]);

    res.json({ 
      success: true, 
      message: 'Password reset successful. Please login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to reset password. Please try again later.' 
    });
  }
});

/**
 * POST /api/users/validate-reset-token
 * Validate reset token (optional endpoint for additional security)
 */
router.post('/api/users/validate-reset-token', async (req, res) => {
  try {
    const { email, reset_token } = req.body;

    if (!email || !reset_token) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and reset token are required' 
      });
    }

    const [users] = await db.query(
      'SELECT id, reset_token, reset_token_expires FROM users WHERE email_id = ? AND reset_token = ?',
      [email, reset_token]
    );

    if (users.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid reset token' 
      });
    }

    const user = users[0];

    if (new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Reset token has expired' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Reset token is valid' 
    });

  } catch (error) {
    console.error('Validate reset token error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to validate reset token' 
    });
  }
});

module.exports = router;