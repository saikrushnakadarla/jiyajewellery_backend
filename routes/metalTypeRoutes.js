const express = require('express');
const db = require('../db'); // your db.js
const router = express.Router();

router.post('/metaltype', async (req, res) => {
  const data = req.body;

  const formatValue = (value) => (value === "" ? null : value);

  try {
    const [result] = await db.query(`
      INSERT INTO metaltype (
        metal_name, default_purity
      ) VALUES (?, ?)
    `, [
      data.metal_name,
      formatValue(data.default_purity)
    ]);

    res.status(201).json({ id: result.insertId, message: 'MetalType record created' });
  } catch (err) {
    console.error('Error inserting metaltype record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/metaltype', async (req, res) => {
  try {
    const [results] = await db.query('SELECT * FROM metaltype');
    res.status(200).json(results);
  } catch (err) {
    console.error('Error fetching metaltype records:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/metaltype/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [results] = await db.query('SELECT * FROM metaltype WHERE metal_type_id = ?', [id]);
    if (results.length === 0) return res.status(404).json({ error: 'Record not found' });

    res.status(200).json(results[0]);
  } catch (err) {
    console.error('Error fetching metaltype by ID:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.put('/metaltype/:id', async (req, res) => {
  const { id } = req.params;
  const data = req.body;

  const formatValue = (value) => (value === "" ? null : value);

  try {
    const [result] = await db.query(`
      UPDATE metaltype
      SET metal_name = ?, default_purity = ?
      WHERE metal_type_id = ?
    `, [
      data.metal_name,
      formatValue(data.default_purity),
      id
    ]);

    if (result.affectedRows === 0) return res.status(404).json({ error: 'Record not found' });

    res.status(200).json({ message: 'MetalType record updated' });
  } catch (err) {
    console.error('Error updating metaltype record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.delete('/metaltype/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db.query('DELETE FROM metaltype WHERE metal_type_id = ?', [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Record not found' });

    res.status(200).json({ message: 'MetalType record deleted' });
  } catch (err) {
    console.error('Error deleting metaltype record:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
