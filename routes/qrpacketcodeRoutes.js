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

// Add new QR packet record
router.post("/api/qr-packets", async (req, res) => {
  try {
    const { prefix, qr_number, qr_code, packet_date, packet_wt, status } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

    let finalQRNumber = qr_number;
    if (!finalQRNumber) {
      finalQRNumber = await getNextQRNumber(prefix);
    }

    const [result] = await db.query(
      `INSERT INTO qr_packets (prefix, qr_number, qr_code, packet_date, packet_wt, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        prefix, 
        finalQRNumber,
        qr_code || null, 
        packet_date, 
        packet_wt ? parseFloat(packet_wt) : null, 
        status || 'Active'
      ]
    );

    res.status(201).json({ 
      success: true, 
      message: "Packet record added successfully",
      id: result.insertId,
      qr_number: finalQRNumber
    });
  } catch (err) {
    console.error("Error adding QR packet:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to add packet record", 
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

    const [result] = await db.query(
      `UPDATE qr_packets 
       SET prefix = ?, qr_number = ?, qr_code = ?, packet_date = ?, packet_wt = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        prefix, 
        finalQRNumber,
        qr_code || null, 
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
router.get("/api/qr-packets/search/:qrData", async (req, res) => {
  try {
    const { qrData } = req.params;
    
    console.log("Fetching packet details for QR:", qrData);
    
    // Try to parse as JSON first
    let searchTerm = qrData;
    
    try {
      const parsedData = JSON.parse(qrData);
      searchTerm = parsedData.qr_code || parsedData.prefix || qrData;
      console.log("Parsed JSON, using search term:", searchTerm);
    } catch (e) {
      // Not JSON, use as is
      console.log("QR is not JSON, searching directly:", searchTerm);
    }
    
    // Search by qr_code, prefix, or full qr code (prefix + qr_number concatenation)
    const [results] = await db.query(
      `SELECT * FROM qr_packets 
       WHERE qr_code = ? 
          OR prefix = ? 
          OR CONCAT(prefix, qr_number) = ?
       ORDER BY created_at DESC 
       LIMIT 1`,
      [searchTerm, searchTerm, searchTerm]
    );
    
    if (results.length === 0) {
      return res.json({
        success: false,
        data: null,
        message: "No packet found with this QR code"
      });
    }
    
    console.log("Packet found:", results[0].prefix);
    
    return res.json({
      success: true,
      data: results[0],
      message: "Packet details fetched successfully"
    });
    
  } catch (error) {
    console.error("Error fetching packet details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch packet details",
      error: error.message
    });
  }
});

module.exports = router;