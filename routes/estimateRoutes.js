const express = require("express");
const db = require("../db"); // mysql2/promise pool
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');


// Helper functions
const sanitizeNumber = (val, def = 0) => (val === "" || val === null ? def : val);
const sanitizeNumeric = (val) => (val ? parseFloat(val.toString().replace(/[^\d.]/g, "")) || 0 : 0);

// Add or update estimate
router.post("/add/estimate", async (req, res) => {
  try {
    const data = req.body;
    console.log("Received estimate data:", JSON.stringify(data, null, 2)); // Debug log
    
    if (!data.date || !data.estimate_number) {
      return res.status(400).json({ message: "Missing required fields: date and estimate_number" });
    }

    // Extract fields with proper fallbacks
    const code = data.code || data.barcode || "";
    const category = data.category || "";
    const subCategory = data.sub_category || "";
    const salespersonId = data.salesperson_id || "";
    const customerId = data.customer_id || "";
    const customerName = data.customer_name || "";
    const estimateStatus = data.estimate_status || "Pending";

    // 1. Check if estimate already exists
    const [checkResult] = await db.query(
      "SELECT COUNT(*) AS count FROM estimate WHERE estimate_number = ?",
      [data.estimate_number]
    );

    if (checkResult[0].count > 0) {
      // 2. Update existing estimate
      const updateSql = `
        UPDATE estimate SET
          date=?, pcode=?, customer_name=?, customer_id=?, salesperson_id=?, estimate_status=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?,
          purity=?, category=?, sub_category=?, gross_weight=?, stone_weight=?, stone_price=?,
          weight_bw=?, va_on=?, va_percent=?, wastage_weight=?, msp_va_percent=?, msp_wastage_weight=?, total_weight_av=?,
          mc_on=?, mc_per_gram=?, making_charges=?, rate=?, rate_amt=?, tax_percent=?,
          tax_amt=?, total_price=?, pricing=?, pieace_cost=?, disscount_percentage=?,
          disscount=?, hm_charges=?, total_amount=?, taxable_amount=?, tax_amount=?, net_amount=?,
          original_total_price=?, opentag_id=?, qty=?
        WHERE estimate_number=?`;

      const updateValues = [
        data.date,
        data.pcode || null,
        customerName,
        customerId,
        salespersonId,
        estimateStatus,
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
        sanitizeNumber(data.opentag_id),
        sanitizeNumber(data.qty),
        data.estimate_number,
      ];

      console.log("Update values:", updateValues); // Debug log
      
      await db.query(updateSql, updateValues);

      return res.status(200).json({ message: "Estimate updated successfully" });
    } else {
      // 3. Insert new estimate
      const insertSql = `
        INSERT INTO estimate (
          date, pcode, customer_name, customer_id, estimate_status, salesperson_id, estimate_number, code, product_id, product_name, metal_type, design_name, purity,
          category, sub_category, gross_weight, stone_weight, stone_price, weight_bw, va_on, va_percent, wastage_weight, 
          msp_va_percent, msp_wastage_weight, total_weight_av, mc_on, mc_per_gram, making_charges, rate, rate_amt, tax_percent,
          tax_amt, total_price, pricing, pieace_cost, disscount_percentage, disscount, hm_charges, total_amount,
          taxable_amount, tax_amount, net_amount, original_total_price, opentag_id, qty
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      const insertValues = [
        data.date,
        data.pcode || null,
        customerName,
        customerId,
        estimateStatus,
        salespersonId,
        data.estimate_number,
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
        sanitizeNumber(data.opentag_id),
        sanitizeNumber(data.qty),
      ];

      console.log("Insert values:", insertValues); // Debug log
      
      const [result] = await db.query(insertSql, insertValues);

      return res.status(200).json({ 
        message: "Estimate added successfully", 
        id: result.insertId,
        estimate_number: data.estimate_number 
      });
    }
  } catch (err) {
    console.error("Error inserting/updating estimate:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get all estimates
router.get("/get/estimates", async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM estimate");
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch estimates", error: err.message });
  }
});

// Edit estimate status by ID - NEW ENDPOINT
router.put("/update-estimate-status/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { estimate_status } = req.body;
    
    if (!estimate_status) {
      return res.status(400).json({ message: "Status is required" });
    }

    console.log(`Updating estimate ID ${id} to status: ${estimate_status}`);

    // First, check if estimate exists by estimate_number or estimate_id
    const [checkResult] = await db.query(
      "SELECT estimate_id FROM estimate WHERE estimate_id = ? OR estimate_number = ?",
      [id, id]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }

    const estimateId = checkResult[0].estimate_id;

    // Update only the status field
    const [result] = await db.query(
      "UPDATE estimate SET estimate_status = ?, updated_at = NOW() WHERE estimate_id = ?",
      [estimate_status, estimateId]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({ message: "Failed to update status" });
    }

    res.json({ 
      success: true, 
      message: "Estimate status updated successfully",
      estimate_id: estimateId,
      estimate_status: estimate_status
    });

  } catch (err) {
    console.error("Error updating estimate status:", err);
    res.status(500).json({ message: "Failed to update estimate status", error: err.message });
  }
});

// Edit estimate by ID
// Edit estimate by ID
router.put("/edit/estimate/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;

    console.log(`Editing estimate with identifier: ${id}`);

    // Check if id is numeric (estimate_id) or string (estimate_number)
    let whereClause = "estimate_id = ?";
    let queryId = id;
    
    // If id is not numeric, assume it's estimate_number
    if (isNaN(id)) {
      whereClause = "estimate_number = ?";
    }

    const sql = `UPDATE estimate SET
        date=?, pcode=?, customer_name=?, customer_id=?, estimate_status=?, salesperson_id=?, estimate_number=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?,
        purity=?, category=?, sub_category=?, gross_weight=?, stone_weight=?, stone_price=?, weight_bw=?, va_on=?, va_percent=?,
        wastage_weight=?, msp_va_percent=?, msp_wastage_weight=?, total_weight_av=?, mc_on=?, mc_per_gram=?, making_charges=?, rate=?, rate_amt=?, tax_percent=?, tax_amt=?, total_price=?
        WHERE ${whereClause}`;

    const [result] = await db.query(sql, [
      data.date, data.pcode, data.customer_name, data.customer_id, data.estimate_status || "Pending", data.salesperson_id, data.estimate_number, data.code, data.product_id, data.product_name, data.metal_type, data.design_name,
      data.purity, data.category, data.sub_category, data.gross_weight, data.stone_weight, data.stone_price, data.weight_bw,
      data.va_on, data.va_percent, data.wastage_weight, data.msp_va_percent, data.msp_wastage_weight, data.total_weight_av, data.mc_on, data.mc_per_gram, data.making_charges,
      data.rate, data.rate_amt, data.tax_percent, data.tax_amt, data.total_price, queryId
    ]);

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

    // Delete the PDF file if it exists
    try {
      const pdfPath = path.join(__dirname, '../uploads/invoices', `${estimateNumber}.pdf`);
      await fs.access(pdfPath); // Check if file exists
      await fs.unlink(pdfPath); // Delete the file
      // console.log(`PDF file deleted: ${estimateNumber}.pdf`);
    } catch (fileError) {
      // File doesn't exist or couldn't be deleted - log but don't fail the operation
      console.log(`PDF file not found or couldn't be deleted: ${estimateNumber}.pdf`, fileError.message);
    }

    // Delete from database
    const [result] = await db.query("DELETE FROM estimate WHERE estimate_number=?", [estimateNumber]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }
    
    res.json({ message: "Estimate deleted successfully" });
    
  } catch (err) {
    console.error('Error deleting estimate:', err.message);
    res.status(500).json({ message: "Failed to delete estimate", error: err.message });
  }
});


// Get last estimate number
router.get("/lastEstimateNumber", async (req, res) => {
  try {
    const [results] = await db.query("SELECT estimate_number FROM estimate WHERE estimate_number LIKE 'EST%' ORDER BY estimate_id DESC");

    if (results.length > 0) {
      const estNumbers = results
        .map(r => r.estimate_number)
        .filter(e => e.startsWith("EST"))
        .map(e => parseInt(e.slice(3), 10));
      const lastNum = Math.max(...estNumbers);
      const nextNum = `EST${String(lastNum + 1).padStart(3, "0")}`;
      res.json({ lastEstimateNumber: nextNum });
    } else {
      res.json({ lastEstimateNumber: "EST001" });
    }
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch last estimate number", error: err.message });
  }
});

// Get unique estimates
router.get("/get-unique-estimates", async (req, res) => {
  try {
    const sql = `
      SELECT * FROM estimate e1
      WHERE e1.estimate_id = (
        SELECT MAX(e2.estimate_id) 
        FROM estimate e2
        WHERE e1.estimate_number = e2.estimate_number
      )
    `;
    const [results] = await db.query(sql);
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

    const [results] = await db.query("SELECT * FROM estimate WHERE estimate_number=?", [estNum]);
    if (!results.length) return res.status(404).json({ message: "No data found for given estimate number" });

    const uniqueData = {
      date: results[0].date,
      estimate_number: results[0].estimate_number,
      total_amount: results[0].total_amount,
      taxable_amount: results[0].taxable_amount,
      tax_amount: results[0].tax_amount,
      net_amount: results[0].net_amount
    };

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
