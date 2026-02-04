const express = require("express");
const db = require("../db"); // mysql2/promise pool
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

// Helper functions
const sanitizeNumber = (val, def = 0) => (val === "" || val === null ? def : val);
const sanitizeNumeric = (val) => (val ? parseFloat(val.toString().replace(/[^\d.]/g, "")) || 0 : 0);

// Helper function to generate order number (ONLY for print/PDF generation)
// FIXED: Helper function to generate unique order number
const generateOrderNumber = async () => {
  try {
    // Use a transaction to ensure we get the latest order number
    const connection = await db.getConnection();
    
    try {
      await connection.beginTransaction();
      
      // Get the latest order number from database
      const [results] = await connection.query(
        "SELECT order_number FROM estimate WHERE order_number IS NOT NULL AND order_number LIKE 'ORD%' ORDER BY LENGTH(order_number) DESC, order_number DESC LIMIT 1"
      );
      
      let sequence = 1;
      
      if (results.length > 0 && results[0].order_number) {
        const lastOrderNum = results[0].order_number;
        
        // Try different formats to extract sequence number
        // Format 1: ORD001, ORD002 (simple format)
        if (lastOrderNum.startsWith('ORD') && lastOrderNum.length > 3) {
          const numPart = lastOrderNum.substring(3);
          const num = parseInt(numPart, 10);
          if (!isNaN(num)) {
            sequence = num + 1;
          }
        }
      }
      
      // Generate simple format: ORD001, ORD002, ORD003
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
    // Fallback: ORD + timestamp
    const timestamp = Date.now().toString().slice(-6);
    return `ORD${timestamp}`;
  }
};


// Update the POST /add/estimate endpoint
router.post("/add/estimate", async (req, res) => {
  try {
    const data = req.body;
    console.log("=== RECEIVING ESTIMATE DATA ===");
    
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
    
    // IMPORTANT: Generate order number and date when source_by is 'customer'
    let orderNumber = null;
    let orderDate = null;
    
    if (sourceBy === 'customer') {
      orderNumber = await generateOrderNumber();
      orderDate = new Date().toISOString().split('T')[0]; // Today's date
      console.log('Generated order number for customer:', orderNumber);
    }

    let estimateStatus;
    if (sourceBy === "customer") {
      estimateStatus = "Ordered";  // Customer creates estimates -> Ordered
    } else {
      estimateStatus = data.estimate_status || "Pending";  // Admin/salesperson -> Pending
    }

    // 1. Check if estimate already exists
    const [checkResult] = await db.query(
      "SELECT COUNT(*) AS count FROM estimate WHERE estimate_number = ?",
      [data.estimate_number]
    );

    if (checkResult[0].count > 0) {
      // Update existing estimate
      console.log("Updating existing estimate...");
      
      // Build update query with order number/date
      let updateSql = `
        UPDATE estimate SET
          date=?, pcode=?, salesperson_id=?, source_by=?, customer_id=?, customer_name=?, 
          estimate_status=?, estimate_number=?, order_number=?, order_date=?, 
          opentag_id=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?, purity=?,
          category=?, sub_category=?, gross_weight=?, stone_weight=?, stone_price=?, 
          weight_bw=?, va_on=?, va_percent=?, wastage_weight=?, msp_va_percent=?, 
          msp_wastage_weight=?, total_weight_av=?, mc_on=?, mc_per_gram=?, making_charges=?, 
          rate=?, rate_amt=?, tax_percent=?, tax_amt=?, total_price=?, pricing=?, pieace_cost=?, 
          disscount_percentage=?, disscount=?, hm_charges=?, total_amount=?, taxable_amount=?, 
          tax_amount=?, net_amount=?, original_total_price=?, qty=?`;
      
      const updateValues = [
        data.date,
        data.pcode || null,
        salespersonId,
        sourceBy,
        customerId,
        customerName,
        estimateStatus,
        data.estimate_number,
        orderNumber, // Now may have value for customer
        orderDate,   // Now may have value for customer
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
        sanitizeNumber(data.qty)
      ];
      
      updateSql += ` WHERE estimate_number=?`;
      updateValues.push(data.estimate_number);
      
      console.log("Update SQL:", updateSql);
      console.log("Order number being set:", orderNumber);
      console.log("Order date being set:", orderDate);
      
      const [updateResult] = await db.query(updateSql, updateValues);
      
      return res.status(200).json({ 
        message: "Estimate updated successfully",
        estimate_number: data.estimate_number,
        order_number: orderNumber, // Return generated order number
        order_date: orderDate      // Return order date
      });
    } else {
      // Insert new estimate with order number/date
      console.log("Inserting new estimate...");
      console.log("Order number for insertion:", orderNumber);
      console.log("Order date for insertion:", orderDate);
      
      // Insert SQL with order number and date
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
          net_amount, estimate_status, original_total_price, qty
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      const insertValues = [
        data.date,
        data.pcode || null,
        salespersonId,
        sourceBy,
        customerId,
        customerName,
        data.estimate_number,
        orderNumber, // Now may have value for customer
        orderDate,   // Now may have value for customer
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
        sanitizeNumber(data.qty)
      ];

      console.log("Insert SQL:", insertSql);
      
      const [result] = await db.query(insertSql, insertValues);

      return res.status(200).json({ 
        message: "Estimate added successfully", 
        id: result.insertId,
        estimate_number: data.estimate_number,
        order_number: orderNumber, // Return generated order number
        order_date: orderDate      // Return order date
      });
    }
  } catch (err) {
    console.error("Error inserting/updating estimate:", err);
    console.error("Error SQL:", err.sql);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// NEW: Generate and assign order number when printing PDF
router.post("/generate-order-number/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    
    if (!estimateNumber) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Generating order number for estimate: ${estimateNumber}`);

    // First, check if estimate exists and already has an order number
    const [checkResult] = await db.query(
      "SELECT estimate_id, order_number FROM estimate WHERE estimate_number = ?",
      [estimateNumber]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }

    const estimateId = checkResult[0].estimate_id;
    const existingOrderNumber = checkResult[0].order_number;

    // If already has an order number, return it
    if (existingOrderNumber) {
      return res.status(200).json({ 
        success: true, 
        message: "Order number already exists",
        order_number: existingOrderNumber,
        order_date: new Date().toISOString().split('T')[0]
      });
    }

    // Generate new order number
    const orderNumber = await generateOrderNumber();
    const orderDate = new Date().toISOString().split('T')[0];

    // Update the estimate with order number and date
    const [updateResult] = await db.query(
      "UPDATE estimate SET order_number = ?, order_date = ?, updated_at = NOW() WHERE estimate_id = ?",
      [orderNumber, orderDate, estimateId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ message: "Failed to update order number" });
    }

    res.status(200).json({ 
      success: true, 
      message: "Order number generated successfully",
      order_number: orderNumber,
      order_date: orderDate
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

// Get estimates by source (admin, salesperson, customer)
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

// Update the Edit estimate status by ID endpoint - FIXED VERSION
// Update estimate status by ID - FIXED VERSION
router.put("/update-estimate-status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { estimate_status } = req.body;
    
    if (!estimate_status) {
      return res.status(400).json({ message: "Status is required" });
    }

    console.log(`Updating estimate with identifier: ${id} to status: ${estimate_status}`);

    // First, check if estimate exists - try both estimate_id and estimate_number
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

    // Check if estimate already has an order number
    if (currentOrderNumber && currentOrderNumber.trim() !== '') {
      return res.status(400).json({ 
        message: "Cannot change status once order number is generated",
        order_number: currentOrderNumber 
      });
    }

    // If estimate was created by customer, don't allow status changes from frontend
    if (sourceBy === "customer") {
      return res.status(400).json({ 
        message: "Customer-created estimates cannot be modified from frontend" 
      });
    }

    // If status is being changed to "Ordered" AND order_number is null/empty
    // Generate order number and date
    let orderNumber = null;
    let orderDate = null;

    if (estimate_status === "Ordered") {
      // Generate order number
      orderNumber = await generateOrderNumber();
      orderDate = new Date().toISOString().split('T')[0];
      console.log(`Generated order number for estimate ${estimateNumber}: ${orderNumber}`);
    }

    // Build update query
    let updateSql = "UPDATE estimate SET estimate_status = ?, updated_at = NOW()";
    const updateValues = [estimate_status];

    if (orderNumber) {
      updateSql += ", order_number = ?, order_date = ?";
      updateValues.push(orderNumber, orderDate);
    }

    updateSql += " WHERE estimate_id = ?";
    updateValues.push(estimateId);

    console.log("Update SQL:", updateSql);
    console.log("Update values:", updateValues);

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
    console.log("Data received for edit:", data);

    // Check if id is numeric (estimate_id) or string (estimate_number)
    let whereClause = "estimate_id = ?";
    let queryId = id;
    
    // If id is not numeric, assume it's estimate_number
    if (isNaN(id)) {
      whereClause = "estimate_number = ?";
    }

    const sql = `UPDATE estimate SET
        date=?, pcode=?, customer_name=?, customer_id=?, salesperson_id=?, source_by=?, estimate_status=?, estimate_number=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?,
        purity=?, category=?, sub_category=?, gross_weight=?, stone_weight=?, stone_price=?, weight_bw=?, va_on=?, va_percent=?,
        wastage_weight=?, msp_va_percent=?, msp_wastage_weight=?, total_weight_av=?, mc_on=?, mc_per_gram=?, making_charges=?, rate=?, rate_amt=?, tax_percent=?, tax_amt=?, total_price=?
        WHERE ${whereClause}`;

    const updateValues = [
      data.date, data.pcode, data.customer_name, data.customer_id, data.salesperson_id, data.source_by, data.estimate_status || "Pending", data.estimate_number, data.code, data.product_id, data.product_name, data.metal_type, data.design_name,
      data.purity, data.category, data.sub_category, data.gross_weight, data.stone_weight, data.stone_price, data.weight_bw,
      data.va_on, data.va_percent, data.wastage_weight, data.msp_va_percent, data.msp_wastage_weight, data.total_weight_av, data.mc_on, data.mc_per_gram, data.making_charges,
      data.rate, data.rate_amt, data.tax_percent, data.tax_amt, data.total_price, queryId
    ];

    console.log("Update values for edit:", updateValues);

    const [result] = await db.query(sql, updateValues);

    if (result.affectedRows === 0) return res.status(404).json({ message: "Estimate not found" });
    
    console.log(`Edit successful, rows affected: ${result.affectedRows}`);
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

    // Delete the PDF file if it exists
    try {
      const pdfPath = path.join(__dirname, '../uploads/invoices', `${estimateNumber}.pdf`);
      await fs.access(pdfPath); // Check if file exists
      await fs.unlink(pdfPath); // Delete the file
      console.log(`PDF file deleted: ${estimateNumber}.pdf`);
    } catch (fileError) {
      // File doesn't exist or couldn't be deleted - log but don't fail the operation
      console.log(`PDF file not found or couldn't be deleted: ${estimateNumber}.pdf`, fileError.message);
    }

    // Delete from database
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
      source_by: results[0].source_by
    };

    console.log("Unique data:", uniqueData);

    const repeatedData = results.map(row => ({
      code: row.code, product_id: row.product_id, product_name: row.product_name,
      metal_type: row.metal_type, design_name: row.design_name, purity: row.purity,
      category: row.category, sub_category: row.sub_category, gross_weight: row.gross_weight,
      stone_weight: row.stone_weight, stone_price: row.stone_price, weight_bw: row.weight_bw,
      va_on: row.va_on, va_percent: row.va_percent, wastage_weight: row.wastage_weight, msp_va_percent: row.msp_va_percent, 
      msp_wastage_weight: row.msp_wastage_weight, total_weight_av: row.total_weight_av, mc_on: row.mc_on, mc_per_gram: row.mc_per_gram,
      making_charges: row.making_charges, rate: row.rate, rate_amt: row.rate_amt,
      tax_percent: row.tax_percent, tax_amt: row.tax_amt, total_price: row.total_price,
      pricing: row.pricing, pieace_cost: row.pieace_cost, disscount_percentage: row.disscount_percentage,
      disscount: row.disscount, hm_charges: row.hm_charges, original_total_price: row.original_total_price,
      opentag_id: row.opentag_id, qty: row.qty
    }));

    res.json({ uniqueData, repeatedData });
  } catch (err) {
    res.status(500).json({ message: "Error fetching data", error: err.message });
  }
});

module.exports = router;