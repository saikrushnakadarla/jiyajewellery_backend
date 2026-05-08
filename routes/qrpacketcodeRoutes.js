const express = require("express");
const db = require("../db");
const router = express.Router();

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
    const { prefix, qr_code, packet_date, packet_wt, status } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

    const [result] = await db.query(
      `INSERT INTO qr_packets (prefix, qr_code, packet_date, packet_wt, status) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        prefix, 
        qr_code || null, 
        packet_date, 
        packet_wt ? parseFloat(packet_wt) : null, 
        status || 'Active'
      ]
    );

    res.status(201).json({ 
      success: true, 
      message: "Packet record added successfully",
      id: result.insertId
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
    const { prefix, qr_code, packet_date, packet_wt, status } = req.body;
    
    if (!prefix || !packet_date) {
      return res.status(400).json({ 
        success: false, 
        message: "Prefix and Date are required fields" 
      });
    }

    const [result] = await db.query(
      `UPDATE qr_packets 
       SET prefix = ?, qr_code = ?, packet_date = ?, packet_wt = ?, status = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        prefix, 
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

module.exports = router;