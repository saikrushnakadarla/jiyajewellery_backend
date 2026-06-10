// qrpacketcodeRoutes.js - Updated with source field

const express = require("express");
const db = require("../db");
const router = express.Router();

// Helper function to generate next QR number for a prefix
async function getNextQRNumber(prefix, source = null) {
  try {
    let query = "SELECT qr_number FROM qr_packets WHERE prefix = ?";
    let params = [prefix];
    
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    
    query += " ORDER BY CAST(qr_number AS UNSIGNED) DESC LIMIT 1";
    
    const [results] = await db.query(query, params);
    
    if (results.length === 0) {
      return "0001";
    }
    
    const lastNumber = parseInt(results[0].qr_number);
    const nextNumber = lastNumber + 1;
    
    return nextNumber.toString().padStart(4, '0');
  } catch (error) {
    console.error("Error getting next QR number:", error);
    return "0001";
  }
}

// Helper function to validate if QR number already exists for a prefix and source
async function isQRNumberExists(prefix, qrNumber, source = null) {
  try {
    let query = "SELECT id FROM qr_packets WHERE prefix = ? AND qr_number = ?";
    let params = [prefix, qrNumber];
    
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    
    const [results] = await db.query(query, params);
    return results.length > 0;
  } catch (error) {
    console.error("Error checking QR number existence:", error);
    return false;
  }
}

// ==================== EXISTING ROUTES (Updated) ====================

// Get all QR packet records
router.get("/api/qr-packets", async (req, res) => {
  try {
    const { source } = req.query;
    let query = "SELECT * FROM qr_packets ORDER BY created_at DESC";
    let params = [];
    
    if (source) {
      query = "SELECT * FROM qr_packets WHERE source = ? ORDER BY created_at DESC";
      params = [source];
    }
    
    const [results] = await db.query(query, params);
    
    res.json({ 
      success: true, 
      data: results,
      message: "Packet records fetched successfully" 
    });
  } catch (err) {
    console.error("Error fetching QR packets:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch packet records", 
      error: err.message 
    });
  }
});

// Add new QR packet record(s) with quantity support
router.post("/api/qr-packets", async (req, res) => {
  try {
    const { prefix, qr_number, qr_code, packet_date, packet_wt, status, quantity, source } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

    // Set source (default to 'OrderManagement' if not provided)
    const recordSource = source || 'OrderManagement';
    
    // Get quantity (default to 1 if not provided)
    const qty = parseInt(quantity) || 1;
    
    if (qty < 1 || qty > 100) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be between 1 and 100"
      });
    }

    // Get the starting QR number
    let startNumber = qr_number;
    if (!startNumber) {
      startNumber = await getNextQRNumber(prefix, recordSource);
    }

    const insertedRecords = [];
    const skippedRecords = [];
    let currentNumber = parseInt(startNumber);

    // Generate multiple QR codes
    for (let i = 0; i < qty; i++) {
      const formattedNumber = currentNumber.toString().padStart(4, '0');
      
      // Check if this QR number already exists for this prefix and source
      const exists = await isQRNumberExists(prefix, formattedNumber, recordSource);
      
      if (exists) {
        skippedRecords.push(`${prefix}${formattedNumber}`);
        currentNumber++;
        continue;
      }

      // Generate QR code data
      const qrData = JSON.stringify({
        qr_code: `${prefix}${formattedNumber}`,
        prefix: prefix,
        qr_number: formattedNumber,
        packet_date: packet_date,
        packet_wt: packet_wt ? parseFloat(packet_wt) : null,
        source: recordSource,
        timestamp: Date.now()
      });

      // Insert record
      const [result] = await db.query(
        `INSERT INTO qr_packets (prefix, qr_number, qr_code, packet_date, packet_wt, status, source) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          prefix, 
          formattedNumber,
          qrData, 
          packet_date, 
          packet_wt ? parseFloat(packet_wt) : null, 
          status || 'Active',
          recordSource
        ]
      );

      insertedRecords.push({
        id: result.insertId,
        prefix: prefix,
        qr_number: formattedNumber,
        full_code: `${prefix}${formattedNumber}`
      });

      currentNumber++;
    }

    // Build response message
    let message = '';
    if (insertedRecords.length > 0 && skippedRecords.length === 0) {
      message = `Successfully generated ${insertedRecords.length} QR code(s) from ${recordSource}`;
    } else if (insertedRecords.length > 0 && skippedRecords.length > 0) {
      message = `Generated ${insertedRecords.length} QR code(s). Skipped ${skippedRecords.length} existing: ${skippedRecords.join(', ')}`;
    } else if (insertedRecords.length === 0) {
      message = 'No QR codes were generated. All numbers already exist.';
    }

    res.status(201).json({ 
      success: true, 
      message: message,
      data: {
        inserted: insertedRecords,
        skipped: skippedRecords,
        total_inserted: insertedRecords.length,
        total_skipped: skippedRecords.length,
        starting_number: `${prefix}${startNumber}`,
        quantity: qty,
        source: recordSource
      }
    });
  } catch (err) {
    console.error("Error adding QR packet(s):", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to add packet record(s)", 
      error: err.message 
    });
  }
});

// Update QR packet record
router.put("/api/qr-packets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { prefix, qr_number, qr_code, packet_date, packet_wt, status, source } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

    // Get current record to preserve source if not provided
    const [currentRecord] = await db.query(
      "SELECT source, prefix FROM qr_packets WHERE id = ?",
      [id]
    );
    
    if (currentRecord.length === 0) {
      return res.status(404).json({ success: false, message: "Packet record not found" });
    }
    
    const recordSource = source || currentRecord[0].source;

    let finalQRNumber = qr_number;
    if (!finalQRNumber) {
      if (currentRecord[0].prefix !== prefix) {
        finalQRNumber = await getNextQRNumber(prefix, recordSource);
      } else {
        finalQRNumber = qr_number || (await getNextQRNumber(prefix, recordSource));
      }
    }

    // Regenerate QR code data
    const qrData = JSON.stringify({
      qr_code: `${prefix}${finalQRNumber}`,
      prefix: prefix,
      qr_number: finalQRNumber,
      packet_date: packet_date,
      packet_wt: packet_wt ? parseFloat(packet_wt) : null,
      source: recordSource,
      timestamp: Date.now()
    });

    const [result] = await db.query(
      `UPDATE qr_packets 
       SET prefix = ?, qr_number = ?, qr_code = ?, packet_date = ?, packet_wt = ?, status = ?, source = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        prefix, 
        finalQRNumber,
        qrData, 
        packet_date, 
        packet_wt ? parseFloat(packet_wt) : null, 
        status || 'Active',
        recordSource,
        id
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Packet record not found" 
      });
    }

    res.json({ 
      success: true, 
      message: "Packet record updated successfully" 
    });
  } catch (err) {
    console.error("Error updating QR packet:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update packet record", 
      error: err.message 
    });
  }
});

// Delete QR packet record
router.delete("/api/qr-packets/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query("DELETE FROM qr_packets WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Packet record not found" 
      });
    }

    res.json({ 
      success: true, 
      message: "Packet record deleted successfully" 
    });
  } catch (err) {
    console.error("Error deleting QR packet:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete packet record", 
      error: err.message 
    });
  }
});

// Get single QR packet by ID
router.get("/api/qr-packets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const [results] = await db.query("SELECT * FROM qr_packets WHERE id = ?", [id]);
    
    if (results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "Packet record not found" 
      });
    }

    res.json({ 
      success: true, 
      data: results[0],
      message: "Packet record fetched successfully" 
    });
  } catch (err) {
    console.error("Error fetching QR packet:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch packet record", 
      error: err.message 
    });
  }
});

// Get QR packet by prefix
router.get("/api/qr-packets/prefix/:prefix", async (req, res) => {
  try {
    const { prefix } = req.params;
    const { source } = req.query;
    
    let query = "SELECT * FROM qr_packets WHERE prefix = ?";
    let params = [prefix];
    
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    
    query += " ORDER BY created_at DESC";
    
    const [results] = await db.query(query, params);
    
    res.json({ 
      success: true, 
      data: results,
      message: "Packet records fetched successfully" 
    });
  } catch (err) {
    console.error("Error fetching QR packets by prefix:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch packet records", 
      error: err.message 
    });
  }
});

// API to check next QR number for a prefix
router.get("/api/qr-packets/next-number/:prefix", async (req, res) => {
  try {
    const { prefix } = req.params;
    const { source } = req.query;
    const nextNumber = await getNextQRNumber(prefix, source);
    
    res.json({ 
      success: true, 
      next_number: nextNumber,
      full_qr_code: `${prefix}${nextNumber}`
    });
  } catch (err) {
    console.error("Error getting next QR number:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to get next QR number", 
      error: err.message 
    });
  }
});

// Update packet status
router.put("/api/qr-packets/update-status/:packetId", async (req, res) => {
  try {
    const { packetId } = req.params;
    const { status } = req.body;
    
    if (!packetId) {
      return res.status(400).json({ success: false, message: "Packet ID is required" });
    }
    
    if (!status || !['Active', 'Used', 'Inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: "Valid status is required" });
    }
    
    const [result] = await db.query(
      "UPDATE qr_packets SET status = ?, updated_at = NOW() WHERE id = ?",
      [status, packetId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Packet not found" });
    }
    
    res.json({ 
      success: true, 
      message: "Packet status updated successfully",
      packet_id: packetId,
      status: status
    });
    
  } catch (err) {
    console.error("Error updating packet status:", err);
    res.status(500).json({ success: false, message: "Failed to update packet status", error: err.message });
  }
});

// Get available packets (status = 'Active')
router.get("/api/qr-packets/available", async (req, res) => {
  try {
    const { source } = req.query;
    let query = "SELECT * FROM qr_packets WHERE status = 'Active'";
    let params = [];
    
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    
    query += " ORDER BY created_at DESC";
    
    const [results] = await db.query(query, params);
    
    res.json({ 
      success: true, 
      data: results,
      count: results.length,
      message: "Available packets fetched successfully" 
    });
  } catch (err) {
    console.error("Error fetching available packets:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch available packets", 
      error: err.message 
    });
  }
});

// Search packet by QR data
router.get("/api/qr-packets/search/:qrData", async (req, res) => {
  try {
    const { qrData } = req.params;
    const { source } = req.query;
    let searchTerm = qrData;

    try {
      const parsedData = JSON.parse(qrData);
      searchTerm = parsedData.qr_code || parsedData.prefix || qrData;
    } catch (e) { /* not JSON, use as-is */ }

    let query = `SELECT * FROM qr_packets 
                 WHERE (CONCAT(prefix, qr_number) = ? OR prefix = ?)
                 AND status = 'Active'`;
    let params = [searchTerm, searchTerm];
    
    if (source) {
      query += " AND source = ?";
      params.push(source);
    }
    
    query += " ORDER BY created_at DESC LIMIT 1";
    
    const [results] = await db.query(query, params);

    if (results.length === 0) {
      return res.json({ success: false, data: null, message: "No available packet found. Packet may already be used." });
    }

    const row = results[0];

    let actualQrCode = `${row.prefix}${row.qr_number}`;
    try {
      const parsed = JSON.parse(row.qr_code);
      if (parsed.qr_code && typeof parsed.qr_code === 'string') {
        actualQrCode = parsed.qr_code;
      }
    } catch (e) {
      if (row.qr_code && typeof row.qr_code === 'string' && !row.qr_code.startsWith('{')) {
        actualQrCode = row.qr_code;
      }
    }

    return res.json({
      success: true,
      data: {
        ...row,
        qr_code: actualQrCode
      },
      message: "Packet details fetched successfully"
    });

  } catch (error) {
    console.error("Error fetching packet details:", error);
    res.status(500).json({ success: false, message: "Failed to fetch packet details", error: error.message });
  }
});

// Get statistics by source
router.get("/api/qr-packets/stats/summary", async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT 
        source,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status = 'Used' THEN 1 ELSE 0 END) as used_count,
        COUNT(DISTINCT prefix) as unique_prefixes
       FROM qr_packets 
       GROUP BY source`
    );
    
    res.json({ 
      success: true, 
      data: results,
      message: "Statistics fetched successfully" 
    });
  } catch (err) {
    console.error("Error fetching statistics:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch statistics", 
      error: err.message 
    });
  }
});

module.exports = router;