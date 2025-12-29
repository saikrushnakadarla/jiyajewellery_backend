const express = require('express');
const db = require('../db');
const router = express.Router();

// GET latest current rates (most recent based on date and time)
router.get('/rates/current', async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT * FROM rates 
             ORDER BY rate_date DESC, rate_time DESC 
             LIMIT 1`
        );

        if (result.length === 0) {
            // Return default rates if none exist
            return res.status(200).json({
                rate_date: new Date().toISOString().split('T')[0],
                rate_time: '00:00:00',
                rate_16crt: 0,
                rate_18crt: 0,
                rate_22crt: 0,
                rate_24crt: 0,
                silver_rate: 0
            });
        }

        res.status(200).json(result[0]);
    } catch (error) {
        console.error('Error fetching current rates:', error);
        res.status(500).json({ 
            error: 'Failed to fetch current rates',
            details: error.message 
        });
    }
});

// GET rate history (all rates except today's)
router.get('/rates/history', async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT * FROM rates 
             WHERE rate_date < CURDATE()
             ORDER BY rate_date DESC, rate_time DESC
             LIMIT 100`
        );

        res.status(200).json(result);
    } catch (error) {
        console.error('Error fetching rate history:', error);
        res.status(500).json({ 
            error: 'Failed to fetch rate history',
            details: error.message 
        });
    }
});

// GET today's rate (if exists)
router.get('/rates/today', async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT * FROM rates 
             WHERE rate_date = CURDATE() 
             ORDER BY rate_time DESC 
             LIMIT 1`
        );

        if (result.length === 0) {
            return res.status(404).json({ 
                message: 'No rates set for today' 
            });
        }

        res.status(200).json(result[0]);
    } catch (error) {
        console.error('Error fetching today\'s rates:', error);
        res.status(500).json({ 
            error: 'Failed to fetch today\'s rates',
            details: error.message 
        });
    }
});

// UPDATE/INSERT rates
router.post('/rates/update', async (req, res) => {
    const {
        rate_date,
        rate_16crt,
        rate_18crt,
        rate_22crt,
        rate_24crt,
        silver_rate,
    } = req.body;

    // Validate required fields
    if (!rate_date || !rate_22crt || !silver_rate) {
        return res.status(400).json({ 
            error: 'Date, 22K Gold rate and Silver rate are required' 
        });
    }

    try {
        const rate_time = new Date().toTimeString().split(' ')[0]; // Get current time in HH:MM:SS format
        
        // First, check if there's already a rate for today
        const [existingRates] = await db.query(
            'SELECT rates_id FROM rates WHERE rate_date = ?',
            [rate_date]
        );

        let insertId;
        
        if (existingRates.length > 0) {
            // Update existing rate for today
            const [updateResult] = await db.query(
                `UPDATE rates 
                 SET 
                    rate_time = ?,
                    rate_16crt = ?,
                    rate_18crt = ?,
                    rate_22crt = ?,
                    rate_24crt = ?,
                    silver_rate = ?,
                    created_at = CURRENT_TIMESTAMP
                 WHERE rate_date = ?`,
                [
                    rate_time,
                    rate_16crt,
                    rate_18crt,
                    rate_22crt,
                    rate_24crt,
                    silver_rate,
                    rate_date
                ]
            );
            insertId = existingRates[0].rates_id;
        } else {
            // Insert new rate
            const [insertResult] = await db.query(
                `INSERT INTO rates (
                    rate_date, 
                    rate_time, 
                    rate_16crt, 
                    rate_18crt, 
                    rate_22crt, 
                    rate_24crt, 
                    silver_rate
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    rate_date,
                    rate_time,
                    rate_16crt,
                    rate_18crt,
                    rate_22crt,
                    rate_24crt,
                    silver_rate
                ]
            );
            insertId = insertResult.insertId;
        }

        res.status(200).json({
            message: existingRates.length > 0 ? 'Rates updated successfully' : 'Rates created successfully',
            rates_id: insertId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error updating rates:', error);
        res.status(500).json({ 
            error: 'Failed to update rates',
            details: error.message 
        });
    }
});

// GET all rates (for admin view)
router.get('/rates/all', async (req, res) => {
    try {
        const [result] = await db.query(
            `SELECT * FROM rates 
             ORDER BY rate_date DESC, rate_time DESC`
        );

        res.status(200).json(result);
    } catch (error) {
        console.error('Error fetching all rates:', error);
        res.status(500).json({ 
            error: 'Failed to fetch rates',
            details: error.message 
        });
    }
});

// Check if table exists and create if not
router.get('/rates/init', async (req, res) => {
    try {
        // Check if rates table exists
        const [tables] = await db.query(
            "SHOW TABLES LIKE 'rates'"
        );
        
        if (tables.length === 0) {
            // Create rates table if it doesn't exist
            await db.query(`
                CREATE TABLE rates (
                    rates_id INT AUTO_INCREMENT PRIMARY KEY,
                    rate_date DATE NOT NULL,
                    rate_time TIME NOT NULL,
                    rate_16crt DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    rate_18crt DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    rate_22crt DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    rate_24crt DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    silver_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            return res.status(200).json({ 
                message: 'Rates table created successfully' 
            });
        }
        
        res.status(200).json({ 
            message: 'Rates table already exists' 
        });
    } catch (error) {
        console.error('Error initializing rates table:', error);
        res.status(500).json({ 
            error: 'Failed to initialize rates table',
            details: error.message 
        });
    }
});

module.exports = router;