const express = require('express');
const db = require('../db'); // your db.js
const router = express.Router();

const sanitizeNumber = (value, defaultValue = 0) =>
  value === "" || value === null || value === undefined
    ? defaultValue
    : parseFloat(value);

router.post('/post/product', async (req, res) => {
  const data = req.body;

  const values = [
    data.category_id,
    data.product_name,
    data.barcode,
    data.metal_type_id,
    data.metal_type,
    data.purity_id,
    data.purity,
    data.design_id,
    data.design,
    sanitizeNumber(data.gross_wt),
    sanitizeNumber(data.stone_wt),
    sanitizeNumber(data.net_wt)
  ];

  const sql = `
    INSERT INTO product (
      category_id, product_name, barcode,
      metal_type_id, metal_type,
      purity_id, purity,
      design_id, design,
      gross_wt, stone_wt, net_wt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const [result] = await db.query(sql, values);
    res.status(201).json({
      message: 'Product created successfully',
      product_id: result.insertId
    });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

router.get('/get/products', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM product`);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

router.get('/get/product/:id', async (req, res) => {
  const { product_id } = req.params;

  try {
    const [[product]] = await db.query(
      `SELECT * FROM product WHERE id = ?`,
      [product_id]
    );

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json(product);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

router.put('/put/product/:product_id', async (req, res) => {
  const { product_id } = req.params;
  const data = req.body;

  const values = [
    data.category_id,
    data.product_name,
    data.barcode,
    data.metal_type_id,
    data.metal_type,
    data.purity_id,
    data.purity,
    data.design_id,
    data.design,
    sanitizeNumber(data.gross_wt),
    sanitizeNumber(data.stone_wt),
    sanitizeNumber(data.net_wt),
    product_id
  ];

  const sql = `
    UPDATE product SET
      category_id = ?, product_name = ?, barcode = ?,
      metal_type_id = ?, metal_type = ?,
      purity_id = ?, purity = ?,
      design_id = ?, design = ?,
      gross_wt = ?, stone_wt = ?, net_wt = ?
    WHERE id = ?
  `;

  try {
    const [result] = await db.query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

router.delete('/delete/product/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    const [result] = await db.query(
      `DELETE FROM product WHERE id = ?`,
      [product_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ message: 'Database error' });
  }
});


module.exports = router;