// leaveManagementRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db'); 

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/leaves';
        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'leave-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only PDF, DOC, DOCX, JPG, JPEG, PNG are allowed.'));
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// POST - Create new leave request
router.post('/api/leave-request', upload.single('attachment'), async (req, res) => {
    try {
        const {
            salesperson_id,
            salesperson_name,
            start_date,
            end_date,
            leave_type,
            description
        } = req.body;

        const attachment = req.file ? req.file.filename : null;

        // Validate required fields
        if (!salesperson_id || !salesperson_name || !start_date || !end_date || !description) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields' 
            });
        }

        // Check for overlapping leave requests
        const [existingLeaves] = await db.query(
            `SELECT id FROM leave_management 
             WHERE salesperson_id = ? 
             AND status != 'Rejected'
             AND ((start_date BETWEEN ? AND ?) 
             OR (end_date BETWEEN ? AND ?)
             OR (? BETWEEN start_date AND end_date)
             OR (? BETWEEN start_date AND end_date))`,
            [salesperson_id, start_date, end_date, start_date, end_date, start_date, end_date]
        );

        if (existingLeaves.length > 0) {
            // Delete uploaded file if exists
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: 'You already have a leave request for these dates'
            });
        }

        // Insert leave request
        const [result] = await db.query(
            `INSERT INTO leave_management 
            (salesperson_id, salesperson_name, start_date, end_date, leave_type, description, attachment, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending')`,
            [salesperson_id, salesperson_name, start_date, end_date, leave_type, description, attachment]
        );

        res.status(201).json({
            success: true,
            message: 'Leave request submitted successfully',
            data: {
                id: result.insertId,
                salesperson_id,
                start_date,
                end_date,
                leave_type,
                status: 'Pending'
            }
        });

    } catch (error) {
        console.error('Error creating leave request:', error);
        // Delete uploaded file if error occurs
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false, 
            message: 'Failed to submit leave request' 
        });
    }
});

// GET - Get all leave requests for a specific salesperson
router.get('/api/leave-requests/:salesperson_id', async (req, res) => {
    try {
        const { salesperson_id } = req.params;

        const [leaves] = await db.query(
            `SELECT id, salesperson_id, salesperson_name, 
                    DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
                    DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
                    leave_type, description, attachment, status,
                    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
             FROM leave_management 
             WHERE salesperson_id = ? 
             ORDER BY created_at DESC`,
            [salesperson_id]
        );

        res.json(leaves);

    } catch (error) {
        console.error('Error fetching leave requests:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch leave requests' 
        });
    }
});

// GET - Get single leave request by ID
router.get('/api/leave-request/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const [leave] = await db.query(
            `SELECT id, salesperson_id, salesperson_name, 
                    DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
                    DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
                    leave_type, description, attachment, status,
                    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
             FROM leave_management 
             WHERE id = ?`,
            [id]
        );

        if (leave.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Leave request not found' 
            });
        }

        res.json(leave[0]);

    } catch (error) {
        console.error('Error fetching leave request:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch leave request' 
        });
    }
});

// PUT - Update leave request
router.put('/api/leave-request/:id', upload.single('attachment'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            start_date,
            end_date,
            leave_type,
            description
        } = req.body;

        // Check if leave request exists and is still pending
        const [existing] = await db.query(
            'SELECT * FROM leave_management WHERE id = ?',
            [id]
        );

        if (existing.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Leave request not found' 
            });
        }

        if (existing[0].status !== 'Pending') {
            // Delete uploaded file if exists
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({
                success: false,
                message: 'Only pending leave requests can be updated'
            });
        }

        let attachment = existing[0].attachment;
        
        // Handle new attachment
        if (req.file) {
            // Delete old attachment if exists
            if (attachment) {
                const oldFilePath = path.join('uploads/leaves', attachment);
                if (fs.existsSync(oldFilePath)) {
                    fs.unlinkSync(oldFilePath);
                }
            }
            attachment = req.file.filename;
        }

        // Update leave request
        await db.query(
            `UPDATE leave_management 
             SET start_date = ?, end_date = ?, leave_type = ?, description = ?, attachment = ?
             WHERE id = ?`,
            [start_date, end_date, leave_type, description, attachment, id]
        );

        res.json({
            success: true,
            message: 'Leave request updated successfully'
        });

    } catch (error) {
        console.error('Error updating leave request:', error);
        // Delete uploaded file if error occurs
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update leave request' 
        });
    }
});

// DELETE - Delete leave request
router.delete('/api/leave-request/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Get leave request to check status and get attachment
        const [leave] = await db.query(
            'SELECT * FROM leave_management WHERE id = ?',
            [id]
        );

        if (leave.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Leave request not found' 
            });
        }

        if (leave[0].status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Only pending leave requests can be deleted'
            });
        }

        // Delete attachment file if exists
        if (leave[0].attachment) {
            const filePath = path.join('uploads/leaves', leave[0].attachment);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // Delete from database
        await db.query('DELETE FROM leave_management WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Leave request deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting leave request:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete leave request' 
        });
    }
});

// GET - Get all leave requests (for admin/manager)
router.get('/api/all-leave-requests', async (req, res) => {
    try {
        const { status, salesperson_id, from_date, to_date } = req.query;
        
        let query = `
            SELECT id, salesperson_id, salesperson_name, 
                   DATE_FORMAT(start_date, '%Y-%m-%d') as start_date,
                   DATE_FORMAT(end_date, '%Y-%m-%d') as end_date,
                   leave_type, description, attachment, status,
                   DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
            FROM leave_management 
            WHERE 1=1
        `;
        
        const params = [];
        
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        
        if (salesperson_id) {
            query += ' AND salesperson_id = ?';
            params.push(salesperson_id);
        }
        
        if (from_date) {
            query += ' AND start_date >= ?';
            params.push(from_date);
        }
        
        if (to_date) {
            query += ' AND end_date <= ?';
            params.push(to_date);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const [leaves] = await db.query(query, params);
        
        res.json(leaves);
        
    } catch (error) {
        console.error('Error fetching all leave requests:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch leave requests' 
        });
    }
});

// PATCH - Update leave request status (for admin/manager)
// PATCH - Update leave request status (for admin/manager)
router.patch('/api/leave-request/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;  // Remove remarks from destructuring
        
        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be Approved or Rejected'
            });
        }
        
        // Remove remarks from the UPDATE query
        const [result] = await db.query(
            `UPDATE leave_management 
             SET status = ?
             WHERE id = ?`,
            [status, id]  // Only pass status and id
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Leave request not found'
            });
        }
        
        res.json({
            success: true,
            message: `Leave request ${status.toLowerCase()} successfully`
        });
        
    } catch (error) {
        console.error('Error updating leave status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update leave status' 
        });
    }
});

// GET - Serve attachment file
router.get('/api/leave-attachment/:filename', (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(__dirname, '../uploads/leaves', filename);
        
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'File not found' 
            });
        }
    } catch (error) {
        console.error('Error serving file:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to serve file' 
        });
    }
});

module.exports = router;