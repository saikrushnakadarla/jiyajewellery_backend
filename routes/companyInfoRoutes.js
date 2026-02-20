const express = require('express');
const db = require('../db'); // your db.js file
const router = express.Router();

router.post('/post/companies', async (req, res) => {
  const {
    company_name, address, address2, city, pincode, state, state_code,
    country, email, mobile, phone, website, gst_no, pan_no, bank_name,
    bank_account_no, ifsc_code, branch, bank_url, latitude, longitude
  } = req.body;

  const companyData = [
    company_name, address, address2, city, pincode, state, state_code,
    country, email, mobile, phone, website, gst_no, pan_no, bank_name,
    bank_account_no, ifsc_code, branch, bank_url, latitude, longitude
  ];

  try {
    const [result] = await db.query(`
      INSERT INTO company_details (
        company_name, address, address2, city, pincode, state, state_code,
        country, email, mobile, phone, website, gst_no, pan_no, bank_name,
        bank_account_no, ifsc_code, branch, bank_url, latitude, longitude
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, companyData);

    res.status(201).json({ message: 'Company added successfully', company_id: result.insertId });
  } catch (err) {
    console.error('Error inserting company details:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/get/companies', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM company_details');
    res.status(200).json(results);
  } catch (err) {
    console.error('Error fetching companies:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/get/companies/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [results] = await db.query('SELECT * FROM company_details WHERE id = ?', [id]);
    if (results.length === 0) return res.status(404).json({ error: 'Company not found' });

    res.status(200).json(results[0]);
  } catch (err) {
    console.error('Error fetching company by ID:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.put('/edit/companies/:id', async (req, res) => {
  const id = req.params.id;
  const {
    company_name, address, address2, city, pincode, state, state_code,
    country, email, mobile, phone, website, gst_no, pan_no, bank_name,
    bank_account_no, ifsc_code, branch, bank_url, latitude, longitude
  } = req.body;

  const companyData = [
    company_name, address, address2, city, pincode, state, state_code,
    country, email, mobile, phone, website, gst_no, pan_no, bank_name,
    bank_account_no, ifsc_code, branch, bank_url, latitude, longitude, id
  ];

  try {
    const [result] = await db.query(`
      UPDATE company_details SET
        company_name = ?, address = ?, address2 = ?, city = ?, pincode = ?, state = ?, state_code = ?,
        country = ?, email = ?, mobile = ?, phone = ?, website = ?, gst_no = ?, pan_no = ?, bank_name = ?,
        bank_account_no = ?, ifsc_code = ?, branch = ?, bank_url = ?, latitude = ?, longitude = ?
      WHERE id = ?
    `, companyData);

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });

    res.status(200).json({ message: 'Company updated successfully' });
  } catch (err) {
    console.error('Error updating company:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.delete('/delete/companies/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [result] = await db.query('DELETE FROM company_details WHERE id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Company not found' });

    res.status(200).json({ message: 'Company deleted successfully' });
  } catch (err) {
    console.error('Error deleting company:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;