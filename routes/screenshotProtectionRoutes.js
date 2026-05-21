// routes/screenshotProtectionRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware to check if user is logged in
const checkAuth = async (req, res, next) => {
    try {
        const { user_id } = req.body;
        
        if (!user_id) {
            return res.status(401).json({ 
                success: false, 
                message: 'User ID required' 
            });
        }
        
        const [users] = await db.query(
            'SELECT id, role, account_status FROM users WHERE id = ?',
            [user_id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        req.user = users[0];
        next();
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Authentication error' 
        });
    }
};

// Record screenshot attempt for salesperson
router.post('/api/screenshot/record', checkAuth, async (req, res) => {
    try {
        const { user_id, device_info, user_agent, ip_address } = req.body;
        const currentDate = new Date().toISOString().split('T')[0];
        const currentTime = new Date().toTimeString().split(' ')[0];
        
        const user = req.user;
        
        // Only track for salesperson accounts
        if (user.role !== 'salesman') {
            return res.status(403).json({ 
                success: false, 
                message: 'Screenshot tracking is only for salesperson accounts',
                role: user.role
            });
        }
        
        // Check if account is already inactive
        if (user.account_status === 'inactive') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been blocked due to multiple screenshot attempts. Please contact administrator.',
                account_blocked: true
            });
        }
        
        // Check if there's an entry for today
        const [existing] = await db.query(
            `SELECT id, screenshot_count FROM salesperson_screenshots 
             WHERE user_id = ? AND screenshot_date = ?`,
            [user_id, currentDate]
        );
        
        let newCount = 1;
        
        if (existing.length > 0) {
            newCount = existing[0].screenshot_count + 1;
            await db.query(
                `UPDATE salesperson_screenshots 
                 SET screenshot_count = ?, screenshot_time = ?, 
                     device_info = ?, user_agent = ?, ip_address = ?
                 WHERE id = ?`,
                [newCount, currentTime, device_info || null, user_agent || null, ip_address || null, existing[0].id]
            );
        } else {
            await db.query(
                `INSERT INTO salesperson_screenshots 
                 (user_id, screenshot_count, screenshot_date, screenshot_time, device_info, user_agent, ip_address)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [user_id, 1, currentDate, currentTime, device_info || null, user_agent || null, ip_address || null]
            );
        }
        
        // Check if screenshot count >= 3, then block account
        let accountBlocked = false;
        if (newCount >= 3) {
            await db.query(
                'UPDATE users SET account_status = "inactive" WHERE id = ?',
                [user_id]
            );
            accountBlocked = true;
            
            console.log(`Salesperson account ${user_id} has been blocked due to ${newCount} screenshot attempts on ${currentDate}`);
        }
        
        res.json({
            success: true,
            screenshot_count: newCount,
            account_blocked: accountBlocked,
            message: accountBlocked 
                ? `Your account has been blocked due to ${newCount} screenshot attempts. Please contact administrator.`
                : `Screenshot attempt recorded (${newCount}/3). Your account will be blocked after 3 attempts.`,
            remaining_attempts: Math.max(0, 3 - newCount)
        });
        
    } catch (error) {
        console.error('Error recording screenshot:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to record screenshot attempt' 
        });
    }
});

// Get screenshot status for a salesperson
router.get('/api/screenshot/status/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const currentDate = new Date().toISOString().split('T')[0];
        
        const [users] = await db.query(
            'SELECT id, role, account_status FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        const user = users[0];
        
        if (user.role !== 'salesman') {
            return res.json({
                success: true,
                is_salesperson: false,
                account_status: user.account_status,
                screenshot_count: 0,
                remaining_attempts: 3,
                message: 'Screenshot tracking is only for salesperson accounts'
            });
        }
        
        const [screenshots] = await db.query(
            `SELECT screenshot_count FROM salesperson_screenshots 
             WHERE user_id = ? AND screenshot_date = ?`,
            [userId, currentDate]
        );
        
        const todayCount = screenshots.length > 0 ? screenshots[0].screenshot_count : 0;
        
        res.json({
            success: true,
            is_salesperson: true,
            account_status: user.account_status,
            screenshot_count: todayCount,
            remaining_attempts: Math.max(0, 3 - todayCount),
            is_blocked: user.account_status === 'inactive'
        });
        
    } catch (error) {
        console.error('Error getting screenshot status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get screenshot status' 
        });
    }
});

// Get screenshot history for a salesperson
router.get('/api/screenshot/history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [history] = await db.query(
            `SELECT id, screenshot_count, screenshot_date, screenshot_time, 
                    device_info, user_agent, ip_address, created_at
             FROM salesperson_screenshots 
             WHERE user_id = ?
             ORDER BY screenshot_date DESC, screenshot_time DESC`,
            [userId]
        );
        
        res.json({
            success: true,
            history: history
        });
        
    } catch (error) {
        console.error('Error getting screenshot history:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get screenshot history' 
        });
    }
});

// Admin endpoint to reactivate blocked salesperson account
router.put('/api/screenshot/reactivate/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const [users] = await db.query(
            'SELECT id, role FROM users WHERE id = ?',
            [userId]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        if (users[0].role !== 'salesman') {
            return res.status(400).json({ 
                success: false, 
                message: 'Only salesperson accounts can be reactivated' 
            });
        }
        
        await db.query(
            'UPDATE users SET account_status = "active" WHERE id = ?',
            [userId]
        );
        
        res.json({
            success: true,
            message: 'Account reactivated successfully'
        });
        
    } catch (error) {
        console.error('Error reactivating account:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to reactivate account' 
        });
    }
});

// Get all blocked salesperson accounts
router.get('/api/screenshot/blocked-accounts', async (req, res) => {
    try {
        const [accounts] = await db.query(
            `SELECT u.id, u.full_name, u.email_id, u.phone, u.account_status,
                    COALESCE(SUM(ss.screenshot_count), 0) as total_screenshots,
                    MAX(ss.screenshot_date) as last_screenshot_date
             FROM users u
             LEFT JOIN salesperson_screenshots ss ON u.id = ss.user_id
             WHERE u.role = 'salesman' AND u.account_status = 'inactive'
             GROUP BY u.id, u.full_name, u.email_id, u.phone, u.account_status
             ORDER BY last_screenshot_date DESC`
        );
        
        res.json({
            success: true,
            accounts: accounts
        });
        
    } catch (error) {
        console.error('Error getting blocked accounts:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get blocked accounts' 
        });
    }
});

module.exports = router;