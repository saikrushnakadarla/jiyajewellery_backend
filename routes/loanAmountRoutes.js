const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all loan amounts with customer details
router.get('/api/loan-amounts', async (req, res) => {
  try {
    const query = `
      SELECT 
        la.id,
        la.loan_id,
        la.user_id,
        la.gold_weight,
        la.purity,
        la.appraised_value,
        la.item_description,
        la.loan_amount,
        la.interest_rate,
        la.duration_months,
        la.status,
        la.due_date,
        la.created_at,
        u.full_name,
        u.phone,
        u.email_id,
        u.city,
        u.state,
        u.pincode
      FROM loan_amounts la
      LEFT JOIN users u ON la.user_id = u.id
      ORDER BY la.created_at DESC
    `;
    
    const [results] = await db.query(query);
    res.json(results);
  } catch (err) {
    console.error('Error fetching loan amounts:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// GET single loan amount by ID
router.get('/api/loan-amounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        la.id,
        la.loan_id,
        la.user_id,
        la.gold_weight,
        la.purity,
        la.appraised_value,
        la.item_description,
        la.loan_amount,
        la.interest_rate,
        la.duration_months,
        la.status,
        la.due_date,
        la.created_at,
        u.full_name,
        u.phone,
        u.email_id,
        u.city,
        u.state,
        u.pincode
      FROM loan_amounts la
      LEFT JOIN users u ON la.user_id = u.id
      WHERE la.id = ?
    `;
    
    const [results] = await db.query(query, [id]);
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'Loan amount not found' });
    }
    res.json(results[0]);
  } catch (err) {
    console.error('Error fetching loan amount:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// POST create new loan amount
router.post('/api/loan-amounts', async (req, res) => {
  try {
    const {
      user_id,
      gold_weight,
      purity,
      appraised_value,
      item_description,
      loan_amount,
      interest_rate,
      duration_months
    } = req.body;

    // Validate required fields
    if (!user_id || !gold_weight || !purity || !loan_amount || !interest_rate || !duration_months) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate loan ID (format: GL-XXX where XXX is auto-increment number)
    const getLastLoanQuery = 'SELECT loan_id FROM loan_amounts ORDER BY id DESC LIMIT 1';
    const [lastLoanResults] = await db.query(getLastLoanQuery);

    let loanNumber = 1;
    if (lastLoanResults.length > 0) {
      const lastLoanId = lastLoanResults[0].loan_id;
      const lastNumber = parseInt(lastLoanId.split('-')[1]);
      loanNumber = lastNumber + 1;
    }
    
    const loan_id = `GL-${String(loanNumber).padStart(3, '0')}`;
    
    // Calculate due date based on duration
    const dueDate = new Date();
    dueDate.setMonth(dueDate.getMonth() + parseInt(duration_months));
    const formattedDueDate = dueDate.toISOString().split('T')[0];
    
    // Insert new loan amount
    const insertQuery = `
      INSERT INTO loan_amounts (
        loan_id, user_id, gold_weight, purity, appraised_value,
        item_description, loan_amount, interest_rate, duration_months,
        status, due_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    
    const status = 'active';
    
    const [result] = await db.query(insertQuery, [
      loan_id, user_id, gold_weight, purity, appraised_value || null,
      item_description || null, loan_amount, interest_rate, duration_months,
      status, formattedDueDate
    ]);
    
    res.status(201).json({
      message: 'Loan created successfully',
      loan_id: loan_id,
      id: result.insertId
    });
  } catch (err) {
    console.error('Error creating loan amount:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// PUT update loan amount status
router.put('/api/loan-amounts/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const validStatuses = ['active', 'closed', 'overdue'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    const query = 'UPDATE loan_amounts SET status = ? WHERE id = ?';
    const [result] = await db.query(query, [status, id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    res.json({ message: 'Loan status updated successfully' });
  } catch (err) {
    console.error('Error updating loan status:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// DELETE loan amount
router.delete('/api/loan-amounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const query = 'DELETE FROM loan_amounts WHERE id = ?';
    const [result] = await db.query(query, [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    res.json({ message: 'Loan deleted successfully' });
  } catch (err) {
    console.error('Error deleting loan:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

module.exports = router;