const express = require("express");
const db = require("../db");
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');

// Configure multer for pack image uploads
const packImageStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/pack-images');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'pack-' + uniqueSuffix + ext);
  }
});

const uploadPackImage = multer({ 
  storage: packImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Helper functions
const sanitizeNumber = (val, def = 0) => (val === "" || val === null ? def : val);
const sanitizeNumeric = (val) => (val ? parseFloat(val.toString().replace(/[^\d.]/g, "")) || 0 : 0);

// Helper function to generate order number
const generateOrderNumber = async () => {
  try {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const [results] = await connection.query(
        "SELECT order_number FROM estimate WHERE order_number IS NOT NULL AND order_number LIKE 'ORD%' ORDER BY LENGTH(order_number) DESC, order_number DESC LIMIT 1"
      );
      
      let sequence = 1;
      
      if (results.length > 0 && results[0].order_number) {
        const lastOrderNum = results[0].order_number;
        
        if (lastOrderNum.startsWith('ORD') && lastOrderNum.length > 3) {
          const numPart = lastOrderNum.substring(3);
          const num = parseInt(numPart, 10);
          if (!isNaN(num)) {
            sequence = num + 1;
          }
        }
      }
      
      const orderNumber = `ORD${String(sequence).padStart(3, "0")}`;
      
      await connection.commit();
      
      console.log(`Generated new order number: ${orderNumber}`);
      return orderNumber;
      
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
    
  } catch (err) {
    console.error("Error generating order number:", err);
    const timestamp = Date.now().toString().slice(-6);
    return `ORD${timestamp}`;
  }
};

// Helper function to generate packet barcode
const generatePacketBarcode = async () => {
  try {
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      const [results] = await connection.query(
        "SELECT packet_barcode FROM estimate WHERE packet_barcode IS NOT NULL AND packet_barcode LIKE 'PKT%' ORDER BY estimate_id DESC LIMIT 1"
      );
      
      let sequence = 1;
      
      if (results.length > 0 && results[0].packet_barcode) {
        const lastBarcode = results[0].packet_barcode;
        
        const match = lastBarcode.match(/^PKT(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num)) {
            sequence = num + 1;
          }
        }
      }
      
      const packetBarcode = `PKT${String(sequence).padStart(5, "0")}`;
      
      await connection.commit();
      
      console.log(`Generated new packet barcode: ${packetBarcode}`);
      return packetBarcode;
      
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
    
  } catch (err) {
    console.error("Error generating packet barcode:", err);
    const timestamp = Date.now().toString().slice(-8);
    return `PKT${timestamp}`;
  }
};

// Upload pack image endpoint
router.post("/upload/pack-image", uploadPackImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }
    
    res.json({ 
      success: true, 
      filename: req.file.filename,
      filePath: `/uploads/pack-images/${req.file.filename}`,
      message: "Image uploaded successfully" 
    });
  } catch (err) {
    console.error("Error uploading pack image:", err);
    res.status(500).json({ message: "Failed to upload image", error: err.message });
  }
});

// Upload multiple pack images
router.post("/upload/pack-images", uploadPackImage.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No image files uploaded" });
    }
    
    const filenames = req.files.map(file => file.filename);
    
    res.json({ 
      success: true, 
      filenames: filenames,
      message: `${filenames.length} images uploaded successfully` 
    });
  } catch (err) {
    console.error("Error uploading pack images:", err);
    res.status(500).json({ message: "Failed to upload images", error: err.message });
  }
});

// Add/Update estimate
// Add/Update estimate
router.post("/add/estimate", async (req, res) => {
  try {
    const data = req.body;
    console.log("=== RECEIVING ESTIMATE DATA ===");
    console.log("Received packet_barcode:", data.packet_barcode);
    console.log("Force insert flag:", data.force_insert);
    
    if (!data.date || !data.estimate_number) {
      return res.status(400).json({ message: "Missing required fields: date and estimate_number" });
    }

    // Extract fields
    const code = data.code || data.barcode || "";
    const category = data.category || "";
    const subCategory = data.sub_category || "";
    const salespersonId = data.salesperson_id || "";
    const customerId = data.customer_id || "";
    const customerName = data.customer_name || "";
    const sourceBy = data.source_by || "";
    
    // Generate order number when source_by is 'customer'
    let orderNumber = null;
    let orderDate = null;
    
    if (sourceBy === 'customer') {
      orderNumber = await generateOrderNumber();
      orderDate = new Date().toISOString().split('T')[0];
      console.log('Generated order number for customer:', orderNumber);
    }

    // Generate packet barcode if not provided or empty
    let packetBarcode = data.packet_barcode;
    if (!packetBarcode || packetBarcode.trim() === '') {
      packetBarcode = await generatePacketBarcode();
      console.log('Generated new packet barcode:', packetBarcode);
    } else {
      console.log('Using provided packet barcode:', packetBarcode);
    }

    // Process pack images
    let packImages = data.pack_images || [];
    if (typeof packImages === 'string') {
      try {
        packImages = JSON.parse(packImages);
      } catch {
        packImages = packImages ? [packImages] : [];
      }
    }
    
    if (!Array.isArray(packImages)) {
      packImages = [];
    }

    const packImagesJson = JSON.stringify(packImages);

    let estimateStatus;
    if (sourceBy === "customer") {
      estimateStatus = "Ordered";
    } else {
      estimateStatus = data.estimate_status || "Pending";
    }

    // Check if estimate with same barcode and estimate_number already exists
    // This prevents duplicate entries for the same product in the same estimate
    const [existingEntryCheck] = await db.query(
      "SELECT COUNT(*) AS count FROM estimate WHERE estimate_number = ? AND code = ?",
      [data.estimate_number, code]
    );

    if (existingEntryCheck[0].count > 0) {
      // Update existing entry with this barcode
      console.log("Updating existing entry with same barcode...");
      
      let updateSql = `
        UPDATE estimate SET
          date=?, pcode=?, salesperson_id=?, source_by=?, customer_id=?, customer_name=?, 
          estimate_status=?, order_number=?, order_date=?, 
          opentag_id=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?, purity=?,
          category=?, sub_category=?, gross_weight=?, stone_weight=?, stone_price=?, 
          weight_bw=?, va_on=?, va_percent=?, wastage_weight=?, msp_va_percent=?, 
          msp_wastage_weight=?, total_weight_av=?, mc_on=?, mc_per_gram=?, making_charges=?, 
          rate=?, rate_amt=?, tax_percent=?, tax_amt=?, total_price=?, pricing=?, pieace_cost=?, 
          disscount_percentage=?, disscount=?, hm_charges=?, total_amount=?, taxable_amount=?, 
          tax_amount=?, net_amount=?, original_total_price=?, qty=?, packet_barcode=?, packet_wt=?, 
          pack_images=?, updated_at = NOW()
        WHERE estimate_number = ? AND code = ?`;
      
      const updateValues = [
        data.date,
        data.pcode || null,
        salespersonId,
        sourceBy,
        customerId,
        customerName,
        estimateStatus,
        orderNumber,
        orderDate,
        sanitizeNumber(data.opentag_id),
        code,
        data.product_id,
        data.product_name,
        data.metal_type,
        data.design_name,
        data.purity,
        category,
        subCategory,
        sanitizeNumber(data.gross_weight),
        sanitizeNumber(data.stone_weight),
        sanitizeNumber(data.stone_price),
        sanitizeNumber(data.weight_bw),
        data.va_on,
        sanitizeNumber(data.va_percent),
        sanitizeNumber(data.wastage_weight),
        sanitizeNumber(data.msp_va_percent),
        sanitizeNumber(data.msp_wastage_weight),
        sanitizeNumber(data.total_weight_av),
        data.mc_on,
        sanitizeNumber(data.mc_per_gram),
        sanitizeNumber(data.making_charges),
        sanitizeNumber(data.rate),
        sanitizeNumber(data.rate_amt),
        sanitizeNumeric(data.tax_percent),
        sanitizeNumber(data.tax_amt),
        sanitizeNumber(data.total_price),
        data.pricing,
        sanitizeNumber(data.pieace_cost),
        sanitizeNumber(data.disscount_percentage),
        sanitizeNumber(data.disscount),
        sanitizeNumber(data.hm_charges),
        sanitizeNumber(data.total_amount),
        sanitizeNumber(data.taxable_amount),
        sanitizeNumber(data.tax_amount),
        sanitizeNumber(data.net_amount),
        sanitizeNumber(data.original_total_price),
        sanitizeNumber(data.qty),
        packetBarcode,
        data.packet_wt ? parseFloat(data.packet_wt) : null,
        packImagesJson,
        data.estimate_number,
        code
      ];
      
      const [updateResult] = await db.query(updateSql, updateValues);
      
      return res.status(200).json({ 
        success: true,
        message: "Estimate entry updated successfully",
        estimate_number: data.estimate_number,
        order_number: orderNumber,
        order_date: orderDate,
        packet_barcode: packetBarcode
      });
    } else {
      // Always INSERT new entry (do not update other entries)
      console.log("Inserting new estimate entry...");
      console.log("Packet barcode for insertion:", packetBarcode);
      
      const insertSql = `
        INSERT INTO estimate (
          date, pcode, salesperson_id, source_by, customer_id, customer_name, 
          estimate_number, order_number, order_date, opentag_id, code, product_id, 
          product_name, metal_type, design_name, purity, category, sub_category, 
          gross_weight, stone_weight, stone_price, weight_bw, va_on, va_percent, 
          wastage_weight, msp_va_percent, msp_wastage_weight, total_weight_av, 
          mc_on, mc_per_gram, making_charges, rate, rate_amt, tax_percent, 
          tax_amt, total_price, pricing, pieace_cost, disscount_percentage, 
          disscount, hm_charges, total_amount, taxable_amount, tax_amount, 
          net_amount, estimate_status, original_total_price, qty, packet_barcode, 
          packet_wt, pack_images
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      const insertValues = [
        data.date,
        data.pcode || null,
        salespersonId,
        sourceBy,
        customerId,
        customerName,
        data.estimate_number,
        orderNumber,
        orderDate,
        sanitizeNumber(data.opentag_id),
        code,
        data.product_id,
        data.product_name,
        data.metal_type,
        data.design_name,
        data.purity,
        category,
        subCategory,
        sanitizeNumber(data.gross_weight),
        sanitizeNumber(data.stone_weight),
        sanitizeNumber(data.stone_price),
        sanitizeNumber(data.weight_bw),
        data.va_on,
        sanitizeNumber(data.va_percent),
        sanitizeNumber(data.wastage_weight),
        sanitizeNumber(data.msp_va_percent),
        sanitizeNumber(data.msp_wastage_weight),
        sanitizeNumber(data.total_weight_av),
        data.mc_on,
        sanitizeNumber(data.mc_per_gram),
        sanitizeNumber(data.making_charges),
        sanitizeNumber(data.rate),
        sanitizeNumber(data.rate_amt),
        sanitizeNumeric(data.tax_percent),
        sanitizeNumber(data.tax_amt),
        sanitizeNumber(data.total_price),
        data.pricing,
        sanitizeNumber(data.pieace_cost),
        sanitizeNumber(data.disscount_percentage),
        sanitizeNumber(data.disscount),
        sanitizeNumber(data.hm_charges),
        sanitizeNumber(data.total_amount),
        sanitizeNumber(data.taxable_amount),
        sanitizeNumber(data.tax_amount),
        sanitizeNumber(data.net_amount),
        estimateStatus,
        sanitizeNumber(data.original_total_price),
        sanitizeNumber(data.qty),
        packetBarcode,
        data.packet_wt ? parseFloat(data.packet_wt) : null,
        packImagesJson
      ];

      const [result] = await db.query(insertSql, insertValues);

      return res.status(200).json({ 
        success: true,
        message: "Estimate added successfully", 
        id: result.insertId,
        estimate_number: data.estimate_number,
        order_number: orderNumber,
        order_date: orderDate,
        packet_barcode: packetBarcode
      });
    }
  } catch (err) {
    console.error("Error inserting/updating estimate:", err);
    console.error("Error SQL:", err.sql);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Update estimate with packet details (for Print button)
router.post("/update/estimate-with-packet", async (req, res) => {
  try {
    const data = req.body;
    console.log("=== UPDATING ESTIMATE WITH PACKET DETAILS ===");
    console.log("Estimate Number:", data.estimate_number);
    console.log("Packet Barcode:", data.packet_barcode);
    
    if (!data.estimate_number) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    // Process pack images
    let packImages = data.pack_images || [];
    if (typeof packImages === 'string') {
      try {
        packImages = JSON.parse(packImages);
      } catch {
        packImages = packImages ? [packImages] : [];
      }
    }
    
    if (!Array.isArray(packImages)) {
      packImages = [];
    }

    const packImagesJson = JSON.stringify(packImages);

    // Update all entries with the same estimate number
    const updateSql = `
      UPDATE estimate SET
        packet_barcode = ?,
        packet_wt = ?,
        pack_images = ?,
        total_amount = ?,
        taxable_amount = ?,
        tax_amount = ?,
        net_amount = ?,
        updated_at = NOW()
      WHERE estimate_number = ?
    `;

    const updateValues = [
      data.packet_barcode || null,
      data.packet_wt ? parseFloat(data.packet_wt) : null,
      packImagesJson,
      sanitizeNumber(data.total_amount),
      sanitizeNumber(data.taxable_amount),
      sanitizeNumber(data.tax_amount),
      sanitizeNumber(data.net_amount),
      data.estimate_number
    ];

    const [result] = await db.query(updateSql, updateValues);

    console.log(`Updated ${result.affectedRows} estimate entries with packet details`);

    res.status(200).json({ 
      success: true,
      message: "Estimate updated with packet details successfully",
      estimate_number: data.estimate_number,
      packet_barcode: data.packet_barcode,
      affected_rows: result.affectedRows
    });

  } catch (err) {
    console.error("Error updating estimate with packet details:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Generate order number when printing
// Generate order number and mark PDF as generated
router.post("/generate-order-number/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    
    if (!estimateNumber) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Generating order number and PDF for estimate: ${estimateNumber}`);

    const [checkResult] = await db.query(
      "SELECT estimate_id, order_number FROM estimate WHERE estimate_number = ? LIMIT 1",
      [estimateNumber]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }

    const estimateId = checkResult[0].estimate_id;
    let orderNumber = checkResult[0].order_number;
    const orderDate = new Date().toISOString().split('T')[0];

    // Generate order number if doesn't exist
    if (!orderNumber) {
      orderNumber = await generateOrderNumber();
    }

    // Update ALL rows for this estimate_number: set order_number and pdf_generated = 1
    const [updateResult] = await db.query(
      "UPDATE estimate SET order_number = ?, order_date = ?, pdf_generated = 1, updated_at = NOW() WHERE estimate_number = ?",
      [orderNumber, orderDate, estimateNumber]
    );

    console.log(`Updated ${updateResult.affectedRows} rows. PDF generated: YES`);

    res.status(200).json({ 
      success: true, 
      message: "Order number generated and PDF marked as ready",
      order_number: orderNumber,
      order_date: orderDate,
      pdf_generated: true
    });

  } catch (err) {
    console.error("Error generating order number:", err);
    res.status(500).json({ message: "Failed to generate order number", error: err.message });
  }
});

// Get all estimates
router.get("/get/estimates", async (req, res) => {
  try {
    console.log("Fetching all estimates...");
    const [results] = await db.query("SELECT * FROM estimate ORDER BY estimate_id DESC");
    console.log(`Found ${results.length} estimates`);
    res.json(results);
  } catch (err) {
    console.error("Error fetching estimates:", err);
    res.status(500).json({ message: "Failed to fetch estimates", error: err.message });
  }
});

// Get estimates by source
router.get("/get/estimates-by-source/:source", async (req, res) => {
  try {
    const source = req.params.source;
    console.log(`Fetching estimates by source: ${source}`);
    
    const [results] = await db.query("SELECT * FROM estimate WHERE source_by = ? ORDER BY estimate_id DESC", [source]);
    console.log(`Found ${results.length} estimates for source: ${source}`);
    
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch estimates by source", error: err.message });
  }
});

// Update estimate status by ID
router.put("/update-estimate-status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { estimate_status } = req.body;
    
    if (!estimate_status) {
      return res.status(400).json({ message: "Status is required" });
    }

    console.log(`Updating estimate with identifier: ${id} to status: ${estimate_status}`);

    const [checkResult] = await db.query(
      "SELECT estimate_id, estimate_number, source_by, estimate_status, order_number FROM estimate WHERE estimate_id = ? OR estimate_number = ? LIMIT 1",
      [id, id]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }

    const estimateId = checkResult[0].estimate_id;
    const estimateNumber = checkResult[0].estimate_number;
    const currentOrderNumber = checkResult[0].order_number;
    const sourceBy = checkResult[0].source_by;

    if (currentOrderNumber && currentOrderNumber.trim() !== '') {
      return res.status(400).json({ 
        message: "Cannot change status once order number is generated",
        order_number: currentOrderNumber 
      });
    }

    if (sourceBy === "customer") {
      return res.status(400).json({ 
        message: "Customer-created estimates cannot be modified from frontend" 
      });
    }

    let orderNumber = null;
    let orderDate = null;

    if (estimate_status === "Ordered") {
      orderNumber = await generateOrderNumber();
      orderDate = new Date().toISOString().split('T')[0];
      console.log(`Generated order number for estimate ${estimateNumber}: ${orderNumber}`);
    }

    let updateSql = "UPDATE estimate SET estimate_status = ?, updated_at = NOW()";
    const updateValues = [estimate_status];

    if (orderNumber) {
      updateSql += ", order_number = ?, order_date = ?";
      updateValues.push(orderNumber, orderDate);
    }

    updateSql += " WHERE estimate_id = ?";
    updateValues.push(estimateId);

    const [result] = await db.query(updateSql, updateValues);

    if (result.affectedRows === 0) {
      return res.status(500).json({ message: "Failed to update status" });
    }

    res.json({ 
      success: true, 
      message: "Estimate status updated successfully",
      estimate_id: estimateId,
      estimate_number: estimateNumber,
      estimate_status: estimate_status,
      order_number: orderNumber,
      order_date: orderDate
    });

  } catch (err) {
    console.error("Error updating estimate status:", err);
    res.status(500).json({ message: "Failed to update estimate status", error: err.message });
  }
});

// Edit estimate by ID
router.put("/edit/estimate/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;

    console.log(`Editing estimate with identifier: ${id}`);

    let whereClause = "estimate_id = ?";
    let queryId = id;
    
    if (isNaN(id)) {
      whereClause = "estimate_number = ?";
    }

    // Process pack images
    let packImages = data.pack_images || [];
    if (typeof packImages === 'string') {
      try {
        packImages = JSON.parse(packImages);
      } catch {
        packImages = packImages ? [packImages] : [];
      }
    }
    
    if (!Array.isArray(packImages)) {
      packImages = [];
    }
    
    const packImagesJson = JSON.stringify(packImages);

    const sql = `UPDATE estimate SET
        date=?, pcode=?, customer_name=?, customer_id=?, salesperson_id=?, source_by=?, 
        estimate_status=?, estimate_number=?, code=?, product_id=?, product_name=?, 
        metal_type=?, design_name=?, purity=?, category=?, sub_category=?, gross_weight=?, 
        stone_weight=?, stone_price=?, weight_bw=?, va_on=?, va_percent=?, wastage_weight=?, 
        msp_va_percent=?, msp_wastage_weight=?, total_weight_av=?, mc_on=?, mc_per_gram=?, 
        making_charges=?, rate=?, rate_amt=?, tax_percent=?, tax_amt=?, total_price=?,
        pricing=?, pieace_cost=?, disscount_percentage=?, disscount=?, hm_charges=?,
        packet_barcode=?, packet_wt=?, pack_images=?
        WHERE ${whereClause}`;

    const updateValues = [
      data.date, 
      data.pcode || null, 
      data.customer_name, 
      data.customer_id, 
      data.salesperson_id, 
      data.source_by, 
      data.estimate_status || "Pending", 
      data.estimate_number, 
      data.code || data.barcode, 
      data.product_id, 
      data.product_name, 
      data.metal_type, 
      data.design_name, 
      data.purity, 
      data.category, 
      data.sub_category, 
      sanitizeNumber(data.gross_weight), 
      sanitizeNumber(data.stone_weight), 
      sanitizeNumber(data.stone_price), 
      sanitizeNumber(data.weight_bw), 
      data.va_on, 
      sanitizeNumber(data.va_percent), 
      sanitizeNumber(data.wastage_weight), 
      sanitizeNumber(data.msp_va_percent), 
      sanitizeNumber(data.msp_wastage_weight), 
      sanitizeNumber(data.total_weight_av), 
      data.mc_on, 
      sanitizeNumber(data.mc_per_gram), 
      sanitizeNumber(data.making_charges), 
      sanitizeNumber(data.rate), 
      sanitizeNumber(data.rate_amt), 
      sanitizeNumeric(data.tax_percent), 
      sanitizeNumber(data.tax_amt), 
      sanitizeNumber(data.total_price),
      data.pricing,
      sanitizeNumber(data.pieace_cost),
      sanitizeNumber(data.disscount_percentage),
      sanitizeNumber(data.disscount),
      sanitizeNumber(data.hm_charges),
      data.packet_barcode || null,
      data.packet_wt ? parseFloat(data.packet_wt) : null,
      packImagesJson,
      queryId
    ];

    const [result] = await db.query(sql, updateValues);

    if (result.affectedRows === 0) return res.status(404).json({ message: "Estimate not found" });
    
    res.json({ success: true, message: "Estimate updated successfully" });
  } catch (err) {
    console.error("Error updating estimate:", err);
    res.status(500).json({ message: "Failed to update estimate", error: err.message });
  }
});

// Delete estimate by estimate_number
router.delete("/delete/estimate/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    
    if (!estimateNumber) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Deleting estimate: ${estimateNumber}`);

    // Get pack images to delete from filesystem
    const [estimateData] = await db.query(
      "SELECT pack_images FROM estimate WHERE estimate_number = ?",
      [estimateNumber]
    );

    // Delete pack images from filesystem
    if (estimateData.length > 0 && estimateData[0].pack_images) {
      try {
        let packImages = estimateData[0].pack_images;
        if (typeof packImages === 'string') {
          packImages = JSON.parse(packImages);
        }
        
        if (Array.isArray(packImages)) {
          for (const image of packImages) {
            if (image && typeof image === 'string') {
              const imagePath = path.join(__dirname, '../uploads/pack-images', image);
              try {
                await fs.access(imagePath);
                await fs.unlink(imagePath);
                console.log(`Deleted pack image: ${image}`);
              } catch (fileError) {
                console.log(`Pack image not found: ${image}`);
              }
            }
          }
        }
      } catch (parseError) {
        console.log('Error parsing pack images:', parseError);
      }
    }

    // Delete PDF file if exists
    try {
      const pdfPath = path.join(__dirname, '../uploads/invoices', `${estimateNumber}.pdf`);
      await fs.access(pdfPath);
      await fs.unlink(pdfPath);
      console.log(`PDF file deleted: ${estimateNumber}.pdf`);
    } catch (fileError) {
      console.log(`PDF file not found: ${estimateNumber}.pdf`);
    }

    const [result] = await db.query("DELETE FROM estimate WHERE estimate_number=?", [estimateNumber]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }
    
    console.log(`Deleted ${result.affectedRows} rows from database`);
    res.json({ message: "Estimate deleted successfully" });
    
  } catch (err) {
    console.error('Error deleting estimate:', err.message);
    res.status(500).json({ message: "Failed to delete estimate", error: err.message });
  }
});

// Get last estimate number
router.get("/lastEstimateNumber", async (req, res) => {
  try {
    console.log("Fetching last estimate number...");
    const [results] = await db.query("SELECT estimate_number FROM estimate WHERE estimate_number LIKE 'EST%' ORDER BY estimate_id DESC");

    if (results.length > 0) {
      const estNumbers = results
        .map(r => r.estimate_number)
        .filter(e => e.startsWith("EST"))
        .map(e => parseInt(e.slice(3), 10));
      const lastNum = Math.max(...estNumbers);
      const nextNum = `EST${String(lastNum + 1).padStart(3, "0")}`;
      console.log(`Last estimate number: EST${lastNum}, Next: ${nextNum}`);
      res.json({ lastEstimateNumber: nextNum });
    } else {
      console.log("No estimates found, starting with EST001");
      res.json({ lastEstimateNumber: "EST001" });
    }
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch last estimate number", error: err.message });
  }
});

// Get next order number (preview only)
router.get("/next-order-number", async (req, res) => {
  try {
    const orderNumber = await generateOrderNumber();
    res.json({ order_number: orderNumber });
  } catch (err) {
    console.error("Error getting next order number:", err);
    res.status(500).json({ message: "Failed to generate order number", error: err.message });
  }
});

// Get next packet barcode
router.get("/next-packet-barcode", async (req, res) => {
  try {
    const packetBarcode = await generatePacketBarcode();
    res.json({ success: true, packet_barcode: packetBarcode });
  } catch (err) {
    console.error("Error getting next packet barcode:", err);
    res.status(500).json({ message: "Failed to generate packet barcode", error: err.message });
  }
});

// Get unique estimates
// Get unique estimates
router.get("/get-unique-estimates", async (req, res) => {
  try {
    console.log("Fetching unique estimates...");
    const sql = `
      SELECT * FROM estimate e1
      WHERE e1.estimate_id = (
        SELECT MAX(e2.estimate_id) 
        FROM estimate e2
        WHERE e1.estimate_number = e2.estimate_number
      )
      ORDER BY e1.estimate_id DESC
    `;
    const [results] = await db.query(sql);
    console.log(`Found ${results.length} unique estimates`);
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Error fetching data", error: err.message });
  }
});

// Get estimates by estimate_number
router.get("/get-estimates/:estimate_number", async (req, res) => {
  try {
    const estNum = req.params.estimate_number;
    if (!estNum) return res.status(400).json({ message: "Estimate number is required" });

    console.log(`Fetching estimates for: ${estNum}`);
    
    const [results] = await db.query("SELECT * FROM estimate WHERE estimate_number=? ORDER BY estimate_id", [estNum]);
    
    if (!results.length) {
      console.log(`No data found for estimate number: ${estNum}`);
      return res.status(404).json({ message: "No data found for given estimate number" });
    }

    console.log(`Found ${results.length} records for estimate number: ${estNum}`);
    
    const uniqueData = {
      date: results[0].date,
      estimate_number: results[0].estimate_number,
      order_number: results[0].order_number,
      order_date: results[0].order_date,
      total_amount: results[0].total_amount,
      taxable_amount: results[0].taxable_amount,
      tax_amount: results[0].tax_amount,
      net_amount: results[0].net_amount,
      salesperson_id: results[0].salesperson_id,
      source_by: results[0].source_by,
      packet_barcode: results[0].packet_barcode,
      packet_wt: results[0].packet_wt,
      pack_images: results[0].pack_images
    };

    const repeatedData = results.map(row => ({
      code: row.code, 
      product_id: row.product_id, 
      product_name: row.product_name,
      metal_type: row.metal_type, 
      design_name: row.design_name, 
      purity: row.purity,
      category: row.category, 
      sub_category: row.sub_category, 
      gross_weight: row.gross_weight,
      stone_weight: row.stone_weight, 
      stone_price: row.stone_price, 
      weight_bw: row.weight_bw,
      va_on: row.va_on, 
      va_percent: row.va_percent, 
      wastage_weight: row.wastage_weight, 
      msp_va_percent: row.msp_va_percent, 
      msp_wastage_weight: row.msp_wastage_weight, 
      total_weight_av: row.total_weight_av, 
      mc_on: row.mc_on, 
      mc_per_gram: row.mc_per_gram,
      making_charges: row.making_charges, 
      rate: row.rate, 
      rate_amt: row.rate_amt,
      tax_percent: row.tax_percent, 
      tax_amt: row.tax_amt, 
      total_price: row.total_price,
      pricing: row.pricing, 
      pieace_cost: row.pieace_cost, 
      disscount_percentage: row.disscount_percentage,
      disscount: row.disscount, 
      hm_charges: row.hm_charges, 
      original_total_price: row.original_total_price,
      opentag_id: row.opentag_id, 
      qty: row.qty
    }));

    res.json({ uniqueData, repeatedData });
  } catch (err) {
    res.status(500).json({ message: "Error fetching data", error: err.message });
  }
});



// Save invoice PDF to server
router.post("/save-invoice/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    const { pdfData } = req.body; // Base64 encoded PDF data

    if (!pdfData) {
      return res.status(400).json({ message: "PDF data is required" });
    }

    // Create uploads directory if not exists
    const uploadDir = path.join(__dirname, '../uploads/invoices');
    await fs.mkdir(uploadDir, { recursive: true });

    // Save PDF file
    const pdfBuffer = Buffer.from(pdfData, 'base64');
    const filePath = path.join(uploadDir, `${estimateNumber}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

    // Update database with invoice path
    const [result] = await db.query(
      "UPDATE estimate SET invoice_pdf = ? WHERE estimate_number = ?",
      [`/uploads/invoices/${estimateNumber}.pdf`, estimateNumber]
    );

    res.json({ 
      success: true, 
      message: "Invoice saved successfully",
      filePath: `/uploads/invoices/${estimateNumber}.pdf`
    });
  } catch (err) {
    console.error("Error saving invoice:", err);
    res.status(500).json({ message: "Failed to save invoice", error: err.message });
  }
});

// Get invoice PDF
// In your backend routes file (estimateRoutes.js or similar)

// Get invoice data for PDF generation (returns JSON, not file)
router.get("/get-invoice/:estimate_number", async (req, res) => {
  try {
    const estNum = req.params.estimate_number;
    
    if (!estNum) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Fetching invoice data for: ${estNum}`);
    
    // Check if pdf_generated is true
    const [checkResult] = await db.query(
      "SELECT pdf_generated, order_number FROM estimate WHERE estimate_number = ? LIMIT 1",
      [estNum]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Get full estimate data
    const [results] = await db.query(
      "SELECT * FROM estimate WHERE estimate_number = ? ORDER BY estimate_id", 
      [estNum]
    );

    if (!results.length) {
      return res.status(404).json({ message: "No data found for given estimate number" });
    }

    // Check if customer is authorized (for customer panel)
    const customerId = req.query.customer_id;
    if (customerId) {
      const estimateCustomerId = results[0].customer_id;
      if (estimateCustomerId && String(estimateCustomerId) !== String(customerId)) {
        return res.status(403).json({ message: "Unauthorized access" });
      }
    }

    const uniqueData = {
      date: results[0].date,
      estimate_number: results[0].estimate_number,
      order_number: results[0].order_number,
      order_date: results[0].order_date,
      total_amount: results[0].total_amount,
      taxable_amount: results[0].taxable_amount,
      tax_amount: results[0].tax_amount,
      net_amount: results[0].net_amount,
      disscount: results[0].disscount,
      customer_name: results[0].customer_name,
      mobile: results[0].customer_id, // You might need a separate mobile field
      pdf_generated: results[0].pdf_generated,
      estimate_status: results[0].estimate_status
    };

    const repeatedData = results.map(row => ({
      code: row.code,
      product_id: row.product_id,
      product_name: row.product_name,
      metal_type: row.metal_type,
      design_name: row.design_name,
      purity: row.purity,
      category: row.category,
      sub_category: row.sub_category,
      gross_weight: row.gross_weight,
      stone_weight: row.stone_weight,
      stone_price: row.stone_price,
      weight_bw: row.weight_bw,
      va_on: row.va_on,
      va_percent: row.va_percent,
      wastage_weight: row.wastage_weight,
      msp_va_percent: row.msp_va_percent,
      msp_wastage_weight: row.msp_wastage_weight,
      total_weight_av: row.total_weight_av,
      mc_on: row.mc_on,
      mc_per_gram: row.mc_per_gram,
      making_charges: row.making_charges,
      rate: row.rate,
      rate_amt: row.rate_amt,
      tax_percent: row.tax_percent,
      tax_amt: row.tax_amt,
      total_price: row.total_price,
      pricing: row.pricing,
      pieace_cost: row.pieace_cost,
      disscount_percentage: row.disscount_percentage,
      disscount: row.disscount,
      hm_charges: row.hm_charges,
      original_total_price: row.original_total_price,
      opentag_id: row.opentag_id,
      qty: row.qty,
      mc_per_gram: row.mc_per_gram
    }));

    res.json({ uniqueData, repeatedData });
  } catch (err) {
    console.error("Error fetching invoice data:", err);
    res.status(500).json({ message: "Error fetching invoice data", error: err.message });
  }
});

module.exports = router;