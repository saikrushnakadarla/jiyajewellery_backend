const express = require("express");
const db = require("../db");
const router = express.Router();

// Helper function to generate next QR number for a prefix
async function getNextQRNumber(prefix) {
  try {
    const [results] = await db.query(
      "SELECT qr_number FROM qr_packets WHERE prefix = ? ORDER BY CAST(qr_number AS UNSIGNED) DESC LIMIT 1",
      [prefix]
    );
    
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

// Helper function to validate if QR number already exists for a prefix
async function isQRNumberExists(prefix, qrNumber) {
  try {
    const [results] = await db.query(
      "SELECT id FROM qr_packets WHERE prefix = ? AND qr_number = ?",
      [prefix, qrNumber]
    );
    return results.length > 0;
  } catch (error) {
    console.error("Error checking QR number existence:", error);
    return false;
  }
}

// ==================== EXISTING ROUTES ====================

// Get all QR packet records
router.get("/api/qr-packets", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT * FROM qr_packets ORDER BY created_at DESC"
    );
    
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
    const { prefix, qr_number, qr_code, packet_date, packet_wt, status, quantity } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

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
      startNumber = await getNextQRNumber(prefix);
    }

    const insertedRecords = [];
    const skippedRecords = [];
    let currentNumber = parseInt(startNumber);

    // Generate multiple QR codes
    for (let i = 0; i < qty; i++) {
      const formattedNumber = currentNumber.toString().padStart(4, '0');
      
      // Check if this QR number already exists for this prefix
      const exists = await isQRNumberExists(prefix, formattedNumber);
      
      if (exists) {
        skippedRecords.push(`${prefix}${formattedNumber}`);
        currentNumber++;
        // Get next available number
        continue;
      }

      // Generate QR code data
      const qrData = JSON.stringify({
        qr_code: `${prefix}${formattedNumber}`,
        prefix: prefix,
        qr_number: formattedNumber,
        packet_date: packet_date,
        packet_wt: packet_wt ? parseFloat(packet_wt) : null,
        timestamp: Date.now()
      });

      // Insert record
      const [result] = await db.query(
        `INSERT INTO qr_packets (prefix, qr_number, qr_code, packet_date, packet_wt, status) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          prefix, 
          formattedNumber,
          qrData, 
          packet_date, 
          packet_wt ? parseFloat(packet_wt) : null, 
          status || 'Active'
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
      message = `Successfully generated ${insertedRecords.length} QR code(s) starting from ${prefix}${startNumber}`;
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
        quantity: qty
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
    const { prefix, qr_number, qr_code, packet_date, packet_wt, status } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

    let finalQRNumber = qr_number;
    if (!finalQRNumber) {
      const [currentRecord] = await db.query(
        "SELECT prefix FROM qr_packets WHERE id = ?",
        [id]
      );
      
      if (currentRecord.length > 0 && currentRecord[0].prefix !== prefix) {
        finalQRNumber = await getNextQRNumber(prefix);
      } else if (currentRecord.length > 0) {
        const [existing] = await db.query(
          "SELECT qr_number FROM qr_packets WHERE id = ?",
          [id]
        );
        finalQRNumber = existing[0]?.qr_number || "0001";
      }
    }

    // Regenerate QR code data
    const qrData = JSON.stringify({
      qr_code: `${prefix}${finalQRNumber}`,
      prefix: prefix,
      qr_number: finalQRNumber,
      packet_date: packet_date,
      packet_wt: packet_wt ? parseFloat(packet_wt) : null,
      timestamp: Date.now()
    });

    const [result] = await db.query(
      `UPDATE qr_packets 
       SET prefix = ?, qr_number = ?, qr_code = ?, packet_date = ?, packet_wt = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        prefix, 
        finalQRNumber,
        qrData, 
        packet_date, 
        packet_wt ? parseFloat(packet_wt) : null, 
        status || 'Active',
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
    
    const [results] = await db.query(
      "SELECT * FROM qr_packets WHERE prefix = ? ORDER BY created_at DESC",
      [prefix]
    );
    
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
    const nextNumber = await getNextQRNumber(prefix);
    
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

// ==================== NEW: Get packet details by QR data (for scanning) ====================
// In your qr-packets route, search endpoint:
router.get("/api/qr-packets/search/:qrData", async (req, res) => {
  try {
    const { qrData } = req.params;
    let searchTerm = qrData;

    try {
      const parsedData = JSON.parse(qrData);
      searchTerm = parsedData.qr_code || parsedData.prefix || qrData;
    } catch (e) { /* not JSON, use as-is */ }

    const [results] = await db.query(
      `SELECT * FROM qr_packets 
       WHERE CONCAT(prefix, qr_number) = ?
          OR prefix = ?
       ORDER BY created_at DESC LIMIT 1`,
      [searchTerm, searchTerm]
    );

    if (results.length === 0) {
      return res.json({ success: false, data: null, message: "No packet found" });
    }

    const row = results[0];

    // FIX: qr_code column stores JSON — parse it to get the actual code string
    let actualQrCode = `${row.prefix}${row.qr_number}`; // reliable fallback
    try {
      const parsed = JSON.parse(row.qr_code);
      if (parsed.qr_code && typeof parsed.qr_code === 'string') {
        actualQrCode = parsed.qr_code;
      }
    } catch (e) {
      // qr_code column is already a plain string
      if (row.qr_code && typeof row.qr_code === 'string' && !row.qr_code.startsWith('{')) {
        actualQrCode = row.qr_code;
      }
    }

    // Return a clean packet object with qr_code as a plain string
    return res.json({
      success: true,
      data: {
        ...row,
        qr_code: actualQrCode  // Always a plain string like "PKT0003"
      },
      message: "Packet details fetched successfully"
    });

  } catch (error) {
    console.error("Error fetching packet details:", error);
    res.status(500).json({ success: false, message: "Failed to fetch packet details", error: error.message });
  }
});

module.exports = router;