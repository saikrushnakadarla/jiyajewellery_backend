const express = require('express');
const db = require('../db');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for PDF uploads
const pdfStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/invoices';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const pdfUpload = multer({
  storage: pdfStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'));
    }
  }
});

router.post('/upload-invoice', pdfUpload.single('invoice'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    res.status(200).json({ 
      message: 'Invoice PDF uploaded successfully',
      filename: req.file.filename 
    });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading invoice', error: error.message });
  }
});

router.get('/invoices/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, '../uploads/invoices', filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ message: 'Invoice not found' });
  }
});

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/products';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

const uploadMultiple = upload.array('images', 10);

const sanitizeNumber = (value, defaultValue = 0) =>
  value === "" || value === null || value === undefined
    ? defaultValue
    : parseFloat(value);

// POST - Create new product with images
router.post('/post/product', (req, res) => {
  uploadMultiple(req, res, async function(err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    const data = req.body;
    const images = req.files ? req.files.map(file => file.filename) : [];

    // Set source - if not provided, default to 'Order Management'
    const source = data.source || 'Order Management';
    
    // Set status - default to 'Available' for new products
    const status = 'Available';

    // NOTE: Barcode is optional now - can be empty string or null
    const barcode = data.barcode && data.barcode.trim() !== '' ? data.barcode : null;

    // VALUES array with status (34th value)
    const values = [
      data.category_id,
      data.product_name,
      barcode,
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
      JSON.stringify(images),
      source,
      status  // Add status field
    ];

    // SQL with 34 placeholders
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
        total_price, pieace_cost, disscount_percentage, disscount, qty,
        images, source, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      const [result] = await db.query(sql, values);
      res.status(201).json({
        message: 'Product created successfully',
        product_id: result.insertId,
        images: images,
        source: source,
        status: status
      });
    } catch (err) {
      if (req.files) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      console.error('Error creating product:', err);
      res.status(500).json({ message: 'Database error', error: err.message });
    }
  });
});

// GET - Get all products
router.get('/get/products', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM product ORDER BY product_id DESC`);
    const products = rows.map(product => ({
      ...product,
      images: product.images ? JSON.parse(product.images) : [],
      source: product.source || 'Order Management',
      status: product.status || 'Available'
    }));
    res.status(200).json(products);
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

    product.images = product.images ? JSON.parse(product.images) : [];
    product.source = product.source || 'Order Management';
    product.status = product.status || 'Available';
    
    res.status(200).json(product);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// PUT - Update product with images
router.put('/update/product/:product_id', (req, res) => {
  uploadMultiple(req, res, async function(err) {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    const { product_id } = req.params;
    const data = req.body;
    const newImages = req.files ? req.files.map(file => file.filename) : [];

    try {
      const [[existingProduct]] = await db.query(
        `SELECT images FROM product WHERE product_id = ?`,
        [product_id]
      );

      let images = [];
      if (existingProduct && existingProduct.images) {
        images = JSON.parse(existingProduct.images);
      }

      if (newImages.length > 0) {
        images = [...images, ...newImages];
      }

      if (data.images_to_delete) {
        const imagesToDelete = JSON.parse(data.images_to_delete);
        images = images.filter(img => !imagesToDelete.includes(img));
        
        imagesToDelete.forEach(filename => {
          const filePath = path.join('uploads/products', filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        });
      }

      const barcode = data.barcode && data.barcode.trim() !== '' ? data.barcode : null;

      // 33 values for UPDATE (32 SET fields + 1 WHERE)
      const values = [
        data.category_id,
        data.product_name,
        barcode,
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
        JSON.stringify(images),
        data.source || 'Order Management',
        product_id  // WHERE clause value
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
          total_price = ?, pieace_cost = ?, disscount_percentage = ?, disscount = ?, qty = ?,
          images = ?, source = ?
        WHERE product_id = ?
      `;

      const [result] = await db.query(sql, values);

      if (result.affectedRows === 0) {
        if (req.files) {
          req.files.forEach(file => {
            fs.unlinkSync(file.path);
          });
        }
        return res.status(404).json({ message: 'Product not found' });
      }

      res.status(200).json({ 
        message: 'Product updated successfully',
        images: images
      });
    } catch (err) {
      if (req.files) {
        req.files.forEach(file => {
          fs.unlinkSync(file.path);
        });
      }
      console.error('Error updating product:', err);
      res.status(500).json({ message: 'Database error', error: err.message });
    }
  });
});

// DELETE - Delete product
router.delete('/delete/product/:product_id', async (req, res) => {
  const { product_id } = req.params;

  try {
    const [[product]] = await db.query(
      `SELECT images FROM product WHERE product_id = ?`,
      [product_id]
    );

    const [result] = await db.query(
      `DELETE FROM product WHERE product_id = ?`,
      [product_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product && product.images) {
      const images = JSON.parse(product.images);
      images.forEach(filename => {
        const filePath = path.join('uploads/products', filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }

    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ message: 'Database error' });
  }
});

// PUT - Update product with QR code status
router.put('/update-product-qr/:product_id', async (req, res) => {
  const { product_id } = req.params;
  const { qr_generated } = req.body;

  try {
    // Check if qr_generated column exists, if not add it
    try {
      await db.query(`ALTER TABLE product ADD COLUMN IF NOT EXISTS qr_generated INT DEFAULT 0`);
    } catch (alterErr) {
      console.log('Column qr_generated might already exist');
    }

    const [result] = await db.query(
      `UPDATE product SET qr_generated = ? WHERE product_id = ?`,
      [qr_generated ? 1 : 0, product_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ 
      message: 'QR status updated successfully'
    });
  } catch (err) {
    console.error('Error updating QR status:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// GET products by source
router.get('/get/products/by-source/:source', async (req, res) => {
  const { source } = req.params;
  
  try {
    const [rows] = await db.query(
      `SELECT * FROM product WHERE source = ?`,
      [source]
    );
    const products = rows.map(product => ({
      ...product,
      images: product.images ? JSON.parse(product.images) : []
    }));
    res.status(200).json(products);
  } catch (err) {
    console.error('Error fetching products by source:', err);
    res.status(500).json({ message: 'Database error' });
  }
});


// Add API endpoint to update product status
router.put('/update/product-status/:product_id', async (req, res) => {
  const { product_id } = req.params;
  const { status } = req.body;

  if (!status || !['Available', 'Selected', 'Ordered'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  try {
    const [result] = await db.query(
      `UPDATE product SET status = ? WHERE product_id = ?`,
      [status, product_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.status(200).json({ 
      message: 'Product status updated successfully',
      status: status
    });
  } catch (err) {
    console.error('Error updating product status:', err);
    res.status(500).json({ message: 'Database error', error: err.message });
  }
});

// Add API endpoint to get available products (for estimates)
router.get('/get/products/available', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM product WHERE status = 'Available' ORDER BY product_id DESC`
    );
    const products = rows.map(product => ({
      ...product,
      images: product.images ? JSON.parse(product.images) : [],
      source: product.source || 'Order Management',
      status: product.status || 'Available'
    }));
    res.status(200).json(products);
  } catch (err) {
    console.error('Error fetching available products:', err);
    res.status(500).json({ message: 'Database error' });
  }
});




router.use('/uploads', express.static('uploads'));

module.exports = router;