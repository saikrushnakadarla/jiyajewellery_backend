const express = require('express');
const db = require('../db'); // your db.js
const router = express.Router();


router.post('/post/category', async (req, res) => {
    const categoryData = req.body;

    const sanitizeInteger = (value, defaultValue = 0) =>
        value === "" || value === null || value === undefined
            ? defaultValue
            : parseInt(value, 10);

    const opening_qty = sanitizeInteger(categoryData.opening_qty, 0);
    const sale_qty = sanitizeInteger(categoryData.sale_qty, 0); // default 0
    const balance_qty = opening_qty - sale_qty;

    const values = [
        categoryData.category_name,
        categoryData.rbarcode,
        sanitizeInteger(categoryData.metal_type_id, null),
        categoryData.metal_type,
        sanitizeInteger(categoryData.tax_slab_id, null),
        categoryData.tax_slab,
        categoryData.hsn_code,
        opening_qty,
        sale_qty,
        balance_qty
    ];

    const sql = `
        INSERT INTO category (
            category_name, rbarcode, metal_type_id, metal_type,
            tax_slab_id, tax_slab, hsn_code,
            opening_qty, sale_qty, balance_qty
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
        const [result] = await db.query(sql, values);
        res.status(201).json({
            message: 'Category added successfully',
            category_id: result.insertId
        });
    } catch (err) {
        console.error('Error inserting category:', err);
        res.status(500).json({ message: 'Database error' });
    }
});

router.get('/get/category', async (req, res) => {
    try {
        const [results] = await db.query('SELECT * FROM category');
        res.status(200).json(results);
    } catch (err) {
        console.error('Error fetching category:', err);
        res.status(500).json({ message: 'Database error', error: err });
    }
});

router.get('/get/category/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query('SELECT * FROM category WHERE category_id = ?', [id]);
        if (results.length === 0) return res.status(404).json({ message: 'Category not found' });
        res.status(200).json(results[0]);
    } catch (err) {
        console.error('Error fetching category:', err);
        res.status(500).json({ message: 'Database error', error: err });
    }
});

router.put('/put/category/:category_id', async (req, res) => {
    const { category_id } = req.params;
    const data = req.body;

    const sanitizeInteger = (value, defaultValue = 0) =>
        value === "" || value === null || value === undefined
            ? defaultValue
            : parseInt(value, 10);

    try {
        // 1️⃣ Get existing sale_qty
        const [[existing]] = await db.query(
            `SELECT sale_qty FROM category WHERE category_id = ?`,
            [category_id]
        );

        if (!existing) {
            return res.status(404).json({ message: 'Category not found' });
        }

        const opening_qty = sanitizeInteger(data.opening_qty, 0);
        const sale_qty = sanitizeInteger(existing.sale_qty, 0);
        const balance_qty = opening_qty - sale_qty;

        // 2️⃣ Update category
        const values = [
            data.category_name,
            data.rbarcode,
            sanitizeInteger(data.metal_type_id, null),
            data.metal_type,
            sanitizeInteger(data.tax_slab_id, null),
            data.tax_slab,
            data.hsn_code,
            opening_qty,
            balance_qty,
            category_id
        ];

        const sql = `
            UPDATE category 
            SET category_name = ?, 
                rbarcode = ?, 
                metal_type_id = ?, 
                metal_type = ?, 
                tax_slab_id = ?, 
                tax_slab = ?, 
                hsn_code = ?, 
                opening_qty = ?, 
                balance_qty = ?
            WHERE category_id = ?
        `;

        const [result] = await db.query(sql, values);

        res.status(200).json({ message: 'Category updated successfully' });

    } catch (err) {
        console.error('Error updating category:', err);
        res.status(500).json({ message: 'Database error' });
    }
});

router.delete('/delete/category/:category_id', async (req, res) => {
    const { category_id } = req.params;
    try {
        const [result] = await db.query('DELETE FROM category WHERE category_id = ?', [category_id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Category not found' });
        res.status(200).json({ message: 'Category deleted successfully' });
    } catch (err) {
        console.error('Error deleting category:', err);
        res.status(500).json({ message: 'Database error', error: err });
    }
});

router.post('/api/check-and-insert', async (req, res) => {
    const { category_name, metal_type } = req.body;

    if (!category_name || !metal_type) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        const [existingProducts] = await db.query(
            `SELECT * FROM category WHERE category_name = ? AND metal_type = ?`,
            [category_name, metal_type]
        );

        if (existingProducts.length > 0) {
            // Category exists — no insertion here
            return res.json({ exists: true, message: 'Category already exists!' });
        }

        // Category does not exist
        return res.json({ exists: false, message: 'Category does not exist.' });
    } catch (err) {
        console.error('Error in category operation:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/last-rbarcode', async (req, res) => {
    try {
        const [result] = await db.query("SELECT rbarcode FROM category WHERE rbarcode LIKE 'RB%' ORDER BY category_id DESC");
        if (result.length > 0) {
            const rbNumbers = result.map(row => row.rbarcode)
                .filter(r => r && r.startsWith('RB'))
                .map(r => parseInt(r.slice(2), 10))
                .filter(n => !isNaN(n));

            const nextRb = rbNumbers.length > 0 ? `RB${String(Math.max(...rbNumbers) + 1).padStart(3, '0')}` : 'RB001';
            return res.json({ lastrbNumbers: nextRb });
        }
        res.json({ lastrbNumbers: 'RB001' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch last rbarcode' });
    }
});



module.exports = router;
