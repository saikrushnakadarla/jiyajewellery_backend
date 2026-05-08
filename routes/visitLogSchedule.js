const express = require('express');
const router = express.Router();
const db = require('../db');

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
    
    // Create notification for the customer about scheduled visit
    await createScheduleNotification(customer_id, salesperson_id, scheduled_date);
    
    // Also send admin notification via SSE
    if (global.sendAdminNotification) {
      global.sendAdminNotification({
        type: 'NEW_SCHEDULE',
        message: `New visit scheduled for customer #${customer_id}`,
        customer_id: customer_id,
        salesperson_id: salesperson_id,
        scheduled_date: scheduled_date,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(201).json({ 
      success: true, 
      message: 'Visit scheduled successfully and notification sent to customer',
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

// Helper function to create notification for customer when visit is scheduled
async function createScheduleNotification(customerId, salespersonId, scheduledDate) {
  try {
    // Get salesperson details
    const [salesperson] = await db.query(
      'SELECT full_name FROM users WHERE id = ?',
      [salespersonId]
    );
    
    const salespersonName = salesperson[0]?.full_name || 'A salesperson';
    
    const scheduledDateTime = new Date(scheduledDate);
    const formattedDate = scheduledDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const formattedTime = scheduledDateTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    const title = '📅 New Visit Scheduled';
    const message = `${salespersonName} has been scheduled to visit you on ${formattedDate} at ${formattedTime}. Please be available at the scheduled time.`;
    
    // Insert notification
    await db.query(
      `INSERT INTO notifications (user_id, user_type, title, message, type, related_id, created_at) 
       VALUES (?, 'customer', ?, ?, 'schedule', ?, NOW())`,
      [customerId, title, message, customerId]
    );
    
    console.log(`Schedule notification sent to customer ${customerId}`);
  } catch (error) {
    console.error('Error creating schedule notification:', error);
  }
}

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
    
    const oldCustomerId = existing[0].customer_id;
    
    // Update the schedule
    await db.query(
      'UPDATE visit_logs_schedule SET customer_id = ?, salesperson_id = ?, scheduled_date = ? WHERE id = ?',
      [customer_id, salesperson_id, scheduled_date, id]
    );
    
    // If customer changed, send notification to both old and new customer
    if (oldCustomerId !== customer_id) {
      // Notify old customer about cancellation
      await db.query(
        `INSERT INTO notifications (user_id, user_type, title, message, type, related_id, created_at) 
         VALUES (?, 'customer', ?, ?, 'schedule', ?, NOW())`,
        [oldCustomerId, '📅 Visit Schedule Updated', 'Your scheduled visit has been rescheduled. Please check with your salesperson for new timing.', id]
      );
      
      // Notify new customer
      await createScheduleNotification(customer_id, salesperson_id, scheduled_date);
    } else {
      // Notify same customer about update
      const scheduledDateTime = new Date(scheduled_date);
      const formattedDate = scheduledDateTime.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const formattedTime = scheduledDateTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      
      await db.query(
        `INSERT INTO notifications (user_id, user_type, title, message, type, related_id, created_at) 
         VALUES (?, 'customer', ?, ?, 'schedule', ?, NOW())`,
        [customer_id, '📅 Visit Schedule Updated', `Your scheduled visit has been updated to ${formattedDate} at ${formattedTime}.`, id]
      );
    }
    
    // Send admin notification
    if (global.sendAdminNotification) {
      global.sendAdminNotification({
        type: 'SCHEDULE_UPDATED',
        message: `Visit schedule #${id} updated`,
        schedule_id: id,
        timestamp: new Date().toISOString()
      });
    }
    
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
    
    // Get schedule details before deleting
    const [schedule] = await db.query(
      'SELECT * FROM visit_logs_schedule WHERE id = ?', 
      [id]
    );
    
    if (schedule.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Schedule not found' 
      });
    }
    
    const { customer_id } = schedule[0];
    
    const [result] = await db.query(
      'DELETE FROM visit_logs_schedule WHERE id = ?', 
      [id]
    );
    
    if (result.affectedRows > 0) {
      // Notify customer about cancellation
      await db.query(
        `INSERT INTO notifications (user_id, user_type, title, message, type, related_id, created_at) 
         VALUES (?, 'customer', ?, ?, 'schedule', ?, NOW())`,
        [customer_id, '❌ Visit Schedule Cancelled', 'Your scheduled visit has been cancelled. Please contact your salesperson for more information.', id]
      );
      
      // Send admin notification
      if (global.sendAdminNotification) {
        global.sendAdminNotification({
          type: 'SCHEDULE_DELETED',
          message: `Visit schedule #${id} deleted`,
          schedule_id: id,
          timestamp: new Date().toISOString()
        });
      }
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

// Get notifications for a user
router.get('/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType = 'customer', limit = 50 } = req.query;
    
    const [notifications] = await db.query(
      `SELECT * FROM notifications 
       WHERE user_id = ? AND user_type = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [userId, userType, parseInt(limit)]
    );
    
    // Get unread count
    const [unreadResult] = await db.query(
      `SELECT COUNT(*) as unread_count FROM notifications 
       WHERE user_id = ? AND user_type = ? AND is_read = FALSE`,
      [userId, userType]
    );
    
    res.json({
      success: true,
      notifications: notifications,
      unreadCount: unreadResult[0].unread_count
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch notifications' 
    });
  }
});

// Mark notification as read
router.put('/notifications/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    await db.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = ?`,
      [notificationId]
    );
    
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark notification as read' 
    });
  }
});

// Mark all notifications as read
router.put('/notifications/mark-all-read/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { userType = 'customer' } = req.body;
    
    await db.query(
      `UPDATE notifications SET is_read = TRUE 
       WHERE user_id = ? AND user_type = ? AND is_read = FALSE`,
      [userId, userType]
    );
    
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to mark notifications as read' 
    });
  }
});

module.exports = router;