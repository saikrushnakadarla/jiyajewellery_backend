const express = require('express');
const router = express.Router();
const db = require('../db'); // Your database connection

// Note: Table creation should be done via the SQL query provided above

// GET - Fetch all scheduled visits
router.get('/', async (req, res) => {
  try {
    const [schedules] = await db.query(`
      SELECT 
        vls.*,
        c.full_name as customer_name,
        c.email_id as customer_email,
        sp.full_name as salesperson_name,
        sp.email_id as salesperson_email,
        sp.phone as salesperson_phone
      FROM visit_logs_schedule vls
      LEFT JOIN users c ON vls.customer_id = c.id
      LEFT JOIN users sp ON vls.salesperson_id = sp.id
      ORDER BY vls.scheduled_date DESC
    `);
    
    res.json(schedules);
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch scheduled visits' 
    });
  }
});

// POST - Create new visit schedule
router.post('/', async (req, res) => {
  try {
    const { customer_id, salesperson_id, scheduled_date } = req.body;
    
    // Validate required fields
    if (!customer_id || !salesperson_id || !scheduled_date) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }
    
    // Validate that customer and salesperson are different
    if (customer_id === salesperson_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer and Salesperson cannot be the same person' 
      });
    }
    
    // Get user details for validation
    const [customer] = await db.query(
      'SELECT id, role FROM users WHERE id = ? AND LOWER(role) = ?', 
      [customer_id, 'customer']
    );
    
    if (customer.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid customer selected' 
      });
    }
    
    const [salesperson] = await db.query(
      'SELECT id, role FROM users WHERE id = ? AND LOWER(role) = ?', 
      [salesperson_id, 'salesman']
    );
    
    if (salesperson.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid salesperson selected' 
      });
    }
    
    // Insert the schedule
    const [result] = await db.query(
      'INSERT INTO visit_logs_schedule (customer_id, salesperson_id, scheduled_date) VALUES (?, ?, ?)',
      [customer_id, salesperson_id, scheduled_date]
    );
    
    res.status(201).json({ 
      success: true, 
      message: 'Visit scheduled successfully',
      scheduleId: result.insertId
    });
    
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to schedule visit' 
    });
  }
});

// PUT - Update visit schedule
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_id, salesperson_id, scheduled_date } = req.body;
    
    // Validate required fields
    if (!customer_id || !salesperson_id || !scheduled_date) {
      return res.status(400).json({ 
        success: false, 
        message: 'All fields are required' 
      });
    }
    
    // Validate that customer and salesperson are different
    if (customer_id === salesperson_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer and Salesperson cannot be the same person' 
      });
    }
    
    // Check if schedule exists
    const [existing] = await db.query(
      'SELECT * FROM visit_logs_schedule WHERE id = ?', 
      [id]
    );
    
    if (existing.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }
    
    // Update the schedule
    await db.query(
      'UPDATE visit_logs_schedule SET customer_id = ?, salesperson_id = ?, scheduled_date = ? WHERE id = ?',
      [customer_id, salesperson_id, scheduled_date, id]
    );
    
    res.json({ success: true, message: 'Schedule updated successfully' });
    
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update schedule' 
    });
  }
});

// DELETE - Delete visit schedule
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await db.query(
      'DELETE FROM visit_logs_schedule WHERE id = ?', 
      [id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }
    
    res.json({ success: true, message: 'Schedule deleted successfully' });
    
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete schedule' 
    });
  }
});

module.exports = router;