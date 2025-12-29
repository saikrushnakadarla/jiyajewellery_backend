const express = require('express');
const db = require('../db');
const router = express.Router();

const sanitizeNumber = (value, defaultValue = 0) =>
  value === "" || value === null || value === undefined
    ? defaultValue
    : parseFloat(value);

// POST - Create new product
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
    sanitizeNumber(data.net_wt),
    sanitizeNumber(data.stone_price),
    data.pricing || 'By Weight',
    data.va_on || 'Gross Weight',
    sanitizeNumber(data.va_percent),
    sanitizeNumber(data.wastage_weight),
    sanitizeNumber(data.total_weight_av),
    data.mc_on || 'MC %',
    sanitizeNumber(data.mc_per_gram),
    sanitizeNumber(data.making_charges),
    sanitizeNumber(data.rate),
    sanitizeNumber(data.rate_amt),
    sanitizeNumber(data.hm_charges, 60.00),
    data.tax_percent || '0.9% GST',
    sanitizeNumber(data.tax_amt),
    sanitizeNumber(data.total_price),
    sanitizeNumber(data.pieace_cost),
    sanitizeNumber(data.disscount_percentage),
    sanitizeNumber(data.disscount),
    sanitizeNumber(data.qty, 1)
  ];

  const sql = `
    INSERT INTO product (
      category_id, product_name, barcode,
      metal_type_id, metal_type,
      purity_id, purity,
      design_id, design,
      gross_wt, stone_wt, net_wt,
      stone_price, pricing, va_on, va_percent, wastage_weight,
      total_weight_av, mc_on, mc_per_gram, making_charges,
      rate, rate_amt, hm_charges, tax_percent, tax_amt,
      total_price, pieace_cost, disscount_percentage, disscount, qty
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    const [result] = await db.query(sql, values);
    res.status(201).json({
      message: 'Product created successfully',
      product_id: result.insertId
    });
  } catch (err) {
    console.error('Error creating product:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// GET - Get all products
router.get('/get/products', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM product`);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// GET - Get single product by ID
router.get('/get/product/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    const [[product]] = await db.query(
      `SELECT * FROM product WHERE product_id = ?`,
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

// PUT - Update product
router.put('/update/product/:product_id', async (req, res) => {
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
    sanitizeNumber(data.stone_price),
    data.pricing || 'By Weight',
    data.va_on || 'Gross Weight',
    sanitizeNumber(data.va_percent),
    sanitizeNumber(data.wastage_weight),
    sanitizeNumber(data.total_weight_av),
    data.mc_on || 'MC %',
    sanitizeNumber(data.mc_per_gram),
    sanitizeNumber(data.making_charges),
    sanitizeNumber(data.rate),
    sanitizeNumber(data.rate_amt),
    sanitizeNumber(data.hm_charges, 60.00),
    data.tax_percent || '0.9% GST',
    sanitizeNumber(data.tax_amt),
    sanitizeNumber(data.total_price),
    sanitizeNumber(data.pieace_cost),
    sanitizeNumber(data.disscount_percentage),
    sanitizeNumber(data.disscount),
    sanitizeNumber(data.qty, 1),
    product_id
  ];

  const sql = `
    UPDATE product SET
      category_id = ?, product_name = ?, barcode = ?,
      metal_type_id = ?, metal_type = ?,
      purity_id = ?, purity = ?,
      design_id = ?, design = ?,
      gross_wt = ?, stone_wt = ?, net_wt = ?,
      stone_price = ?, pricing = ?, va_on = ?, va_percent = ?, wastage_weight = ?,
      total_weight_av = ?, mc_on = ?, mc_per_gram = ?, making_charges = ?,
      rate = ?, rate_amt = ?, hm_charges = ?, tax_percent = ?, tax_amt = ?,
      total_price = ?, pieace_cost = ?, disscount_percentage = ?, disscount = ?, qty = ?
    WHERE product_id = ?
  `;

  try {
    const [result] = await db.query(sql, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ message: 'Product updated successfully' });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// DELETE - Delete product
router.delete('/delete/product/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    const [result] = await db.query(
      `DELETE FROM product WHERE product_id = ?`,
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