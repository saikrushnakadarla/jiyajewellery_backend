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
    console.log("=== RECEIVING ESTIMATE DATA ===");
    console.log("Full request body received:", JSON.stringify(data, null, 2));
    
    // Log the specific fields we're interested in
    console.log("salesperson_id from request:", data.salesperson_id);
    console.log("source_by from request:", data.source_by);
    console.log("customer_id from request:", data.customer_id);
    console.log("customer_name from request:", data.customer_name);
    console.log("estimate_number from request:", data.estimate_number);
    
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
    const sourceBy = data.source_by || "";
     // Change it to:
        let estimateStatus
        if (data.source_by === "customer") {
            estimateStatus = "Ordered";  // Customer creates estimates -> Ordered
        } else {
            estimateStatus = data.estimate_status || "Pending";  // Admin/salesperson -> Pending
        }


    console.log("Extracted values for database:");
    console.log("salespersonId:", salespersonId);
    console.log("sourceBy:", sourceBy);
    console.log("customerId:", customerId);
    console.log("customerName:", customerName);

    // 1. Check if estimate already exists
    const [checkResult] = await db.query(
      "SELECT COUNT(*) AS count FROM estimate WHERE estimate_number = ?",
      [data.estimate_number]
    );

    console.log(`Check if estimate exists: ${checkResult[0].count} records found`);

    if (checkResult[0].count > 0) {
      // 2. Update existing estimate
      console.log("Updating existing estimate...");
      const updateSql = `
        UPDATE estimate SET
          date=?, pcode=?, customer_name=?, customer_id=?, salesperson_id=?, source_by=?, estimate_status=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?,
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
        sourceBy,
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

      console.log("Update SQL:", updateSql);
      console.log("Update values (first 10):", updateValues.slice(0, 10));
      console.log("salespersonId in updateValues:", updateValues[4]);
      console.log("sourceBy in updateValues:", updateValues[5]);
      
      const [updateResult] = await db.query(updateSql, updateValues);
      console.log("Update result:", updateResult);
      console.log(`Rows affected: ${updateResult.affectedRows}`);

      // Verify the update worked
      const [verifyResult] = await db.query(
        "SELECT salesperson_id, source_by FROM estimate WHERE estimate_number = ?",
        [data.estimate_number]
      );
      console.log("Verification after update:", verifyResult[0]);

      return res.status(200).json({ 
        message: "Estimate updated successfully",
        salesperson_id: salespersonId,
        source_by: sourceBy
      });
    } else {
      // 3. Insert new estimate
      console.log("Inserting new estimate...");
      const insertSql = `
        INSERT INTO estimate (
          date, pcode, customer_name, customer_id, salesperson_id, source_by, estimate_status, estimate_number, code, product_id, product_name, metal_type, design_name, purity,
          category, sub_category, gross_weight, stone_weight, stone_price, weight_bw, va_on, va_percent, wastage_weight, 
          msp_va_percent, msp_wastage_weight, total_weight_av, mc_on, mc_per_gram, making_charges, rate, rate_amt, tax_percent,
          tax_amt, total_price, pricing, pieace_cost, disscount_percentage, disscount, hm_charges, total_amount,
          taxable_amount, tax_amount, net_amount, original_total_price, opentag_id, qty
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

      const insertValues = [
        data.date,
        data.pcode || null,
        customerName,
        customerId,
        salespersonId,
        sourceBy,
        estimateStatus,
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

      console.log("Insert SQL:", insertSql);
      console.log("Insert values (first 10):", insertValues.slice(0, 10));
      console.log("salespersonId in insertValues:", insertValues[4]);
      console.log("sourceBy in insertValues:", insertValues[5]);
      
      const [result] = await db.query(insertSql, insertValues);
      console.log("Insert result:", result);
      console.log(`Insert ID: ${result.insertId}`);

      // Verify the insert worked
      const [verifyResult] = await db.query(
        "SELECT salesperson_id, source_by FROM estimate WHERE estimate_id = ?",
        [result.insertId]
      );
      console.log("Verification after insert:", verifyResult[0]);

      return res.status(200).json({ 
        message: "Estimate added successfully", 
        id: result.insertId,
        estimate_number: data.estimate_number,
        salesperson_id: salespersonId,
        source_by: sourceBy
      });
    }
  } catch (err) {
    console.error("=== ERROR INSERTING/UPDATING ESTIMATE ===");
    console.error("Error message:", err.message);
    console.error("Error stack:", err.stack);
    console.error("Request body that caused error:", req.body);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Get all estimates
router.get("/get/estimates", async (req, res) => {
  try {
    console.log("Fetching all estimates...");
    const [results] = await db.query("SELECT * FROM estimate ORDER BY estimate_id DESC");
    console.log(`Found ${results.length} estimates`);
    
    // Log a sample of what's stored
    if (results.length > 0) {
      console.log("Sample estimate record:");
      console.log("estimate_id:", results[0].estimate_id);
      console.log("salesperson_id:", results[0].salesperson_id);
      console.log("source_by:", results[0].source_by);
      console.log("estimate_number:", results[0].estimate_number);
    }
    
    res.json(results);
  } catch (err) {
    console.error("Error fetching estimates:", err);
    res.status(500).json({ message: "Failed to fetch estimates", error: err.message });
  }
});

// NEW: Get estimates by source (admin, salesperson, customer)
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

// Edit estimate status by ID
// In router.put("/update-estimate-status/:id", update it to:

// Update the backend status update endpoint (estimate.js)
router.put("/update-estimate-status/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const { estimate_status, customer_action } = req.body;
        
        if (!estimate_status) {
            return res.status(400).json({ message: "Status is required" });
        }

        console.log(`Updating estimate ID ${id} to status: ${estimate_status}`);
        console.log('Customer action flag:', customer_action);

        // First, check if estimate exists and get current data
        const [checkResult] = await db.query(
            "SELECT estimate_id, source_by, estimate_status FROM estimate WHERE estimate_id = ? OR estimate_number = ?",
            [id, id]
        );

        if (checkResult.length === 0) {
            return res.status(404).json({ message: "Estimate not found" });
        }

        const estimateId = checkResult[0].estimate_id;
        const sourceBy = checkResult[0].source_by;
        const currentStatus = checkResult[0].estimate_status;

        // Validate status transition
        if (sourceBy === "customer") {
            // Customer-created estimate logic
            
            // If estimate is already "Ordered", customer should NOT be able to change it
            if (currentStatus === "Ordered") {
                return res.status(400).json({ 
                    success: false,
                    message: "Customer cannot change status once estimate is Ordered" 
                });
            }
        } else if (sourceBy === "admin" || sourceBy === "salesman") {
            // Admin/salesperson created estimate
            if (customer_action === true && estimate_status === "Accepted") {
                // Customer is changing admin/salesperson's estimate to Accepted
                // Store as "Ordered" instead of "Accepted"
                const finalStatus = "Ordered";
                
                const [result] = await db.query(
                    "UPDATE estimate SET estimate_status = ?, customer_accepted = 1, updated_at = NOW() WHERE estimate_id = ?",
                    [finalStatus, estimateId]
                );
                
                if (result.affectedRows === 0) {
                    return res.status(500).json({ message: "Failed to update status" });
                }

                return res.json({ 
                    success: true, 
                    message: "Estimate accepted by customer",
                    estimate_id: estimateId,
                    estimate_status: finalStatus,
                    customer_accepted: true
                });
            }
        }

        // For admin/salesperson changing their own estimates or other cases
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

// Debug endpoint to check table structure
router.get("/debug/table-structure", async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'estimate' 
      AND TABLE_SCHEMA = DATABASE()
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log("Table structure for 'estimate':");
    results.forEach(col => {
      console.log(`${col.COLUMN_NAME}: ${col.DATA_TYPE} (Nullable: ${col.IS_NULLABLE})`);
    });
    
    res.json(results);
  } catch (err) {
    console.error("Error getting table structure:", err);
    res.status(500).json({ message: "Error getting table structure", error: err.message });
  }
});

module.exports = router;