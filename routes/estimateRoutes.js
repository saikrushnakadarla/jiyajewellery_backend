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
  limits: { fileSize: 5 * 1024 * 1024 },
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

// Helper function to insert notification into database
const insertNotification = async (userId, userType, title, message, type, relatedId = null) => {
  try {
    const sql = `
      INSERT INTO notifications (user_id, user_type, title, message, type, related_id, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
    `;
    const [result] = await db.query(sql, [userId, userType, title, message, type, relatedId]);
    return result.insertId;
  } catch (err) {
    console.error("Error inserting notification:", err);
    return null;
  }
};

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

// FIXED: Main Add/Update estimate endpoint
router.post("/add/estimate", async (req, res) => {
  try {
    const data = req.body;
    console.log("=== RECEIVING ESTIMATE DATA ===");
    console.log("Received packet_barcode:", data.packet_barcode);
    console.log("total_price:", data.total_price);
    console.log("net_amount:", data.net_amount);
    
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

    // Handle packet barcode correctly
    let packetBarcode = data.packet_barcode;
    
    if (packetBarcode === undefined || packetBarcode === null || packetBarcode === "" || packetBarcode === "null" || packetBarcode === "NULL") {
      packetBarcode = null;
      console.log('No packet barcode provided - setting to NULL');
    }

    // Process pack images
    let packImages = data.pack_images || [];
    if (typeof packImages === 'string') {
      try {
        packImages = JSON.parse(packImages);
      } catch {
        packImages = [];
      }
    }
    if (!Array.isArray(packImages)) packImages = [];
    
    const packImagesJson = JSON.stringify(packImages);

    let estimateStatus;
    if (sourceBy === "customer") {
      estimateStatus = "Ordered";
    } else {
      estimateStatus = data.estimate_status || "Pending";
    }

    // Determine navigation path
    let navigationPath = null;
    if (sourceBy === 'salesman' && salespersonId) {
      navigationPath = `/salesperson-transactions/${salespersonId}`;
    } else if (customerId) {
      navigationPath = `/customer-transactions/${customerId}`;
    }

    // Prepare values array - EXACTLY 50 placeholders
    const insertValues = [
      data.date,                                    // 1
      data.pcode || null,                           // 2
      salespersonId,                                // 3
      sourceBy,                                     // 4
      customerId,                                   // 5
      customerName,                                 // 6
      data.estimate_number,                         // 7
      orderNumber,                                  // 8
      orderDate,                                    // 9
      sanitizeNumber(data.opentag_id),              // 10
      code,                                         // 11
      data.product_id,                              // 12
      data.product_name,                            // 13
      data.metal_type,                              // 14
      data.design_name,                             // 15
      data.purity,                                  // 16
      category,                                     // 17
      subCategory,                                  // 18
      sanitizeNumber(data.gross_weight),            // 19
      sanitizeNumber(data.stone_weight),            // 20
      sanitizeNumber(data.stone_price),             // 21
      sanitizeNumber(data.weight_bw),               // 22
      data.va_on,                                   // 23
      sanitizeNumber(data.va_percent),              // 24
      sanitizeNumber(data.wastage_weight),          // 25
      sanitizeNumber(data.total_weight_av),         // 26
      data.mc_on,                                   // 27
      sanitizeNumber(data.mc_per_gram),             // 28
      sanitizeNumber(data.making_charges),          // 29
      sanitizeNumber(data.rate),                    // 30
      sanitizeNumber(data.rate_amt),                // 31
      sanitizeNumeric(data.tax_percent),            // 32
      sanitizeNumber(data.tax_amt),                 // 33
      sanitizeNumber(data.total_price),             // 34
      data.pricing,                                 // 35
      sanitizeNumber(data.pieace_cost),             // 36
      sanitizeNumber(data.disscount_percentage),    // 37
      sanitizeNumber(data.disscount),               // 38
      sanitizeNumber(data.hm_charges),              // 39
      sanitizeNumber(data.total_amount),            // 40
      sanitizeNumber(data.taxable_amount),          // 41
      sanitizeNumber(data.tax_amount),              // 42
      sanitizeNumber(data.net_amount),              // 43
      estimateStatus,                               // 44
      sanitizeNumber(data.original_total_price),    // 45
      sanitizeNumber(data.qty),                     // 46
      packetBarcode,                                // 47
      data.packet_wt ? parseFloat(data.packet_wt) : null, // 48
      packImagesJson                                // 49
    ];

    // Check if we're using force_insert mode or regular insert
    if (data.force_insert) {
      console.log("Force insert mode - inserting new estimate entry...");
      
      // Count the number of placeholders - should be 49
      const placeholders = insertValues.map(() => '?').join(',');
      
      const insertSql = `
        INSERT INTO estimate (
          date, pcode, salesperson_id, source_by, customer_id, customer_name, 
          estimate_number, order_number, order_date, opentag_id, code, product_id, 
          product_name, metal_type, design_name, purity, category, sub_category, 
          gross_weight, stone_weight, stone_price, weight_bw, va_on, va_percent, 
          wastage_weight, total_weight_av, mc_on, mc_per_gram, making_charges, 
          rate, rate_amt, tax_percent, tax_amt, total_price, pricing, pieace_cost, 
          disscount_percentage, disscount, hm_charges, total_amount, taxable_amount, 
          tax_amount, net_amount, estimate_status, original_total_price, qty, 
          packet_barcode, packet_wt, pack_images
        ) VALUES (${placeholders})
      `;

      console.log("SQL Query:", insertSql);
      console.log("Values count:", insertValues.length);
      
      const [result] = await db.query(insertSql, insertValues);

      // Send notifications
      if (sourceBy === 'salesman' && salespersonId) {
        const adminUserId = 1;
        
        const notificationTitle = `New Estimate Created`;
        const notificationMessage = `🆕 New estimate #${data.estimate_number} created by salesperson for ${customerName || 'Customer'}`;
        
        await insertNotification(
          adminUserId,
          'admin',
          notificationTitle,
          notificationMessage,
          'NEW_ESTIMATE',
          result.insertId
        );
        
        if (global.sendAdminNotification) {
          const notification = {
            type: 'NEW_ESTIMATE',
            id: Date.now(),
            estimate_number: data.estimate_number,
            customer_name: customerName,
            salesperson_id: salespersonId,
            total_amount: sanitizeNumber(data.net_amount),
            timestamp: new Date().toISOString(),
            message: notificationMessage,
            action_by: 'salesperson',
            notification_id: result.insertId
          };
          global.sendAdminNotification(notification);
          console.log('✅ New estimate notification sent to admin');
        }
        
        await insertNotification(
          salespersonId,
          'salesman',
          'Estimate Created',
          `Your estimate #${data.estimate_number} has been created successfully for ${customerName || 'Customer'}`,
          'ESTIMATE_CREATED',
          result.insertId
        );
      } else if (customerId) {
        const notificationTitle = `Estimate Created`;
        const notificationMessage = `📋 Your estimate #${data.estimate_number} has been created successfully`;
        
        await insertNotification(
          customerId,
          'customer',
          notificationTitle,
          notificationMessage,
          'ESTIMATE_CREATED',
          result.insertId
        );
        
        if (global.sendCustomerNotification) {
          const notification = {
            type: 'ESTIMATE_CREATED',
            id: Date.now(),
            estimate_number: data.estimate_number,
            total_amount: sanitizeNumber(data.net_amount),
            timestamp: new Date().toISOString(),
            message: notificationMessage
          };
          global.sendCustomerNotification(customerId, notification);
          console.log(`✅ Estimate notification sent to customer ${customerId}`);
        }
      }

      return res.status(200).json({ 
        success: true,
        message: "Estimate added successfully", 
        id: result.insertId,
        estimate_number: data.estimate_number,
        order_number: orderNumber,
        order_date: orderDate,
        packet_barcode: packetBarcode,
        total_price: data.total_price,
        net_amount: data.net_amount,
        navigation_path: navigationPath,
        source_by: sourceBy,
        salesperson_id: salespersonId,
        customer_id: customerId
      });
    } else {
      // Regular insert - check for existing entry
      const [existingEntryCheck] = await db.query(
        "SELECT COUNT(*) AS count FROM estimate WHERE estimate_number = ? AND code = ?",
        [data.estimate_number, code]
      );

      if (existingEntryCheck[0].count > 0) {
        // Update existing entry
        console.log("Updating existing entry with same barcode...");
        
        const placeholders = insertValues.map(() => '?').join(',');
        
        const updateSql = `
          UPDATE estimate SET
            date=?, pcode=?, salesperson_id=?, source_by=?, customer_id=?, customer_name=?, 
            estimate_status=?, order_number=?, order_date=?, 
            opentag_id=?, code=?, product_id=?, product_name=?, metal_type=?, design_name=?, purity=?,
            category=?, sub_category=?, gross_weight=?, stone_weight=?, stone_price=?, 
            weight_bw=?, va_on=?, va_percent=?, wastage_weight=?, total_weight_av=?, 
            mc_on=?, mc_per_gram=?, making_charges=?, rate=?, rate_amt=?, tax_percent=?, 
            tax_amt=?, total_price=?, pricing=?, pieace_cost=?, disscount_percentage=?, 
            disscount=?, hm_charges=?, total_amount=?, taxable_amount=?, tax_amount=?, 
            net_amount=?, original_total_price=?, qty=?, packet_barcode=?, packet_wt=?, 
            pack_images=?, updated_at = NOW()
          WHERE estimate_number = ? AND code = ?`;
        
        const updateValues = [...insertValues, data.estimate_number, code];
        
        const [updateResult] = await db.query(updateSql, updateValues);
        
        return res.status(200).json({ 
          success: true,
          message: "Estimate entry updated successfully",
          estimate_number: data.estimate_number,
          order_number: orderNumber,
          order_date: orderDate,
          packet_barcode: packetBarcode,
          total_price: data.total_price,
          net_amount: data.net_amount,
          navigation_path: navigationPath,
          source_by: sourceBy,
          salesperson_id: salespersonId,
          customer_id: customerId
        });
      } else {
        // INSERT new entry
        console.log("Inserting new estimate entry...");
        
        const placeholders = insertValues.map(() => '?').join(',');
        
        const insertSql = `
          INSERT INTO estimate (
            date, pcode, salesperson_id, source_by, customer_id, customer_name, 
            estimate_number, order_number, order_date, opentag_id, code, product_id, 
            product_name, metal_type, design_name, purity, category, sub_category, 
            gross_weight, stone_weight, stone_price, weight_bw, va_on, va_percent, 
            wastage_weight, total_weight_av, mc_on, mc_per_gram, making_charges, 
            rate, rate_amt, tax_percent, tax_amt, total_price, pricing, pieace_cost, 
            disscount_percentage, disscount, hm_charges, total_amount, taxable_amount, 
            tax_amount, net_amount, estimate_status, original_total_price, qty, 
            packet_barcode, packet_wt, pack_images
          ) VALUES (${placeholders})`;

        const [result] = await db.query(insertSql, insertValues);

        // Send notifications
        if (sourceBy === 'salesman' && salespersonId) {
          const adminUserId = 1;
          
          const notificationTitle = `New Estimate Created`;
          const notificationMessage = `🆕 New estimate #${data.estimate_number} created by salesperson for ${customerName || 'Customer'}`;
          
          await insertNotification(
            adminUserId,
            'admin',
            notificationTitle,
            notificationMessage,
            'NEW_ESTIMATE',
            result.insertId
          );
          
          if (global.sendAdminNotification) {
            const notification = {
              type: 'NEW_ESTIMATE',
              id: Date.now(),
              estimate_number: data.estimate_number,
              customer_name: customerName,
              salesperson_id: salespersonId,
              total_amount: sanitizeNumber(data.net_amount),
              timestamp: new Date().toISOString(),
              message: notificationMessage,
              action_by: 'salesperson',
              notification_id: result.insertId
            };
            global.sendAdminNotification(notification);
            console.log('✅ New estimate notification sent to admin');
          }
          
          await insertNotification(
            salespersonId,
            'salesman',
            'Estimate Created',
            `Your estimate #${data.estimate_number} has been created successfully for ${customerName || 'Customer'}`,
            'ESTIMATE_CREATED',
            result.insertId
          );
        } else if (customerId) {
          const notificationTitle = `Estimate Created`;
          const notificationMessage = `📋 Your estimate #${data.estimate_number} has been created successfully`;
          
          await insertNotification(
            customerId,
            'customer',
            notificationTitle,
            notificationMessage,
            'ESTIMATE_CREATED',
            result.insertId
          );
          
          if (global.sendCustomerNotification) {
            const notification = {
              type: 'ESTIMATE_CREATED',
              id: Date.now(),
              estimate_number: data.estimate_number,
              total_amount: sanitizeNumber(data.net_amount),
              timestamp: new Date().toISOString(),
              message: notificationMessage
            };
            global.sendCustomerNotification(customerId, notification);
            console.log(`✅ Estimate notification sent to customer ${customerId}`);
          }
        }

        return res.status(200).json({ 
          success: true,
          message: "Estimate added successfully", 
          id: result.insertId,
          estimate_number: data.estimate_number,
          order_number: orderNumber,
          order_date: orderDate,
          packet_barcode: packetBarcode,
          total_price: data.total_price,
          net_amount: data.net_amount,
          navigation_path: navigationPath,
          source_by: sourceBy,
          salesperson_id: salespersonId,
          customer_id: customerId
        });
      }
    }
  } catch (err) {
    console.error("Error inserting/updating estimate:", err);
    console.error("Error details:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Update packet barcode for all entries with same estimate_number
router.put("/update/estimate-packet/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    const { packet_barcode, packet_wt } = req.body;
    
    if (!estimateNumber) {
      return res.status(400).json({ message: "Estimate number is required" });
    }
    
    console.log(`Updating packet barcode for estimate: ${estimateNumber}`);
    console.log(`New packet_barcode: ${packet_barcode}`);
    
    const [result] = await db.query(
      "UPDATE estimate SET packet_barcode = ?, packet_wt = ?, updated_at = NOW() WHERE estimate_number = ?",
      [packet_barcode || null, packet_wt ? parseFloat(packet_wt) : null, estimateNumber]
    );
    
    console.log(`Updated ${result.affectedRows} entries with packet barcode: ${packet_barcode}`);
    
    res.json({ 
      success: true, 
      message: "Packet barcode updated successfully",
      affected_rows: result.affectedRows,
      packet_barcode: packet_barcode
    });
  } catch (err) {
    console.error("Error updating packet barcode:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Update estimate images for all entries with same estimate_number
router.post("/update/estimate-images", async (req, res) => {
  try {
    const { estimate_number, pack_images } = req.body;
    
    if (!estimate_number) {
      return res.status(400).json({ message: "Estimate number is required" });
    }
    
    const packImagesJson = JSON.stringify(pack_images || []);
    
    const [result] = await db.query(
      "UPDATE estimate SET pack_images = ?, updated_at = NOW() WHERE estimate_number = ?",
      [packImagesJson, estimate_number]
    );
    
    console.log(`Updated ${result.affectedRows} entries with pack images for estimate: ${estimate_number}`);
    
    res.json({ 
      success: true, 
      message: "Images updated successfully",
      affected_rows: result.affectedRows
    });
  } catch (err) {
    console.error("Error updating estimate images:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// MARK NOTIFICATION AS READ endpoint
router.put("/notifications/:id/read", async (req, res) => {
  try {
    const notificationId = req.params.id;
    
    const [result] = await db.query(
      "UPDATE notifications SET is_read = 1, updated_at = NOW() WHERE id = ?",
      [notificationId]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }
    
    res.json({ success: true, message: "Notification marked as read" });
  } catch (err) {
    console.error("Error marking notification as read:", err);
    res.status(500).json({ message: "Failed to mark notification as read", error: err.message });
  }
});

// MARK ALL NOTIFICATIONS AS READ for a user
router.put("/notifications/mark-all-read/:userType/:userId", async (req, res) => {
  try {
    const { userType, userId } = req.params;
    
    const [result] = await db.query(
      "UPDATE notifications SET is_read = 1, updated_at = NOW() WHERE user_type = ? AND user_id = ? AND is_read = 0",
      [userType, userId]
    );
    
    res.json({ 
      success: true, 
      message: `${result.affectedRows} notifications marked as read`,
      count: result.affectedRows
    });
  } catch (err) {
    console.error("Error marking all notifications as read:", err);
    res.status(500).json({ message: "Failed to mark notifications as read", error: err.message });
  }
});

// GET NOTIFICATIONS for a user
router.get("/notifications/:userType/:userId", async (req, res) => {
  try {
    const { userType, userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    
    const [results] = await db.query(
      `SELECT id, user_id, user_type, title, message, type, related_id, is_read, 
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
              DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
       FROM notifications 
       WHERE user_type = ? AND user_id = ? 
       ORDER BY created_at DESC 
       LIMIT ?`,
      [userType, userId, limit]
    );
    
    const [countResult] = await db.query(
      "SELECT COUNT(*) as unread_count FROM notifications WHERE user_type = ? AND user_id = ? AND is_read = 0",
      [userType, userId]
    );
    
    res.json({ 
      success: true, 
      notifications: results,
      unread_count: countResult[0].unread_count,
      total: results.length
    });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: "Failed to fetch notifications", error: err.message });
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

    let packImages = data.pack_images || [];
    if (typeof packImages === 'string') {
      try {
        packImages = JSON.parse(packImages);
      } catch {
        packImages = [];
      }
    }
    if (!Array.isArray(packImages)) packImages = [];
    
    const packImagesJson = JSON.stringify(packImages);

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
router.post("/generate-order-number/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    
    if (!estimateNumber) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Generating order number and PDF for estimate: ${estimateNumber}`);

    const [checkResult] = await db.query(
      "SELECT estimate_id, order_number, customer_id, salesperson_id FROM estimate WHERE estimate_number = ? LIMIT 1",
      [estimateNumber]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }

    const estimateId = checkResult[0].estimate_id;
    let orderNumber = checkResult[0].order_number;
    const orderDate = new Date().toISOString().split('T')[0];
    const customerId = checkResult[0].customer_id;
    const salespersonId = checkResult[0].salesperson_id;

    if (!orderNumber) {
      orderNumber = await generateOrderNumber();
    }

    const [updateResult] = await db.query(
      "UPDATE estimate SET order_number = ?, order_date = ?, pdf_generated = 1, updated_at = NOW() WHERE estimate_number = ?",
      [orderNumber, orderDate, estimateNumber]
    );

    console.log(`Updated ${updateResult.affectedRows} rows. PDF generated: YES`);

    if (customerId) {
      const notificationTitle = `Order Generated`;
      const notificationMessage = `✅ Your order #${orderNumber} has been generated for estimate #${estimateNumber}`;
      
      await insertNotification(
        customerId,
        'customer',
        notificationTitle,
        notificationMessage,
        'ORDER_GENERATED',
        estimateId
      );
      
      if (global.sendCustomerNotification) {
        const notification = {
          type: 'ORDER_GENERATED',
          id: Date.now(),
          estimate_number: estimateNumber,
          order_number: orderNumber,
          timestamp: new Date().toISOString(),
          message: notificationMessage
        };
        global.sendCustomerNotification(customerId, notification);
      }
    }

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
      "SELECT estimate_id, estimate_number, source_by, estimate_status, order_number, customer_name, salesperson_id, customer_id FROM estimate WHERE estimate_id = ? OR estimate_number = ? LIMIT 1",
      [id, id]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Estimate not found" });
    }

    const estimateId = checkResult[0].estimate_id;
    const estimateNumber = checkResult[0].estimate_number;
    const currentOrderNumber = checkResult[0].order_number;
    const sourceBy = checkResult[0].source_by;
    const customerName = checkResult[0].customer_name;
    const salespersonId = checkResult[0].salesperson_id;
    const customerId = checkResult[0].customer_id;

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

    const oldStatus = checkResult[0].estimate_status;
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

    if (oldStatus !== estimate_status) {
      const adminUserId = 1;
      
      const adminNotificationTitle = `Estimate Status Changed`;
      const adminNotificationMessage = `📝 Estimate #${estimateNumber} status changed from ${oldStatus} to ${estimate_status}`;
      
      await insertNotification(
        adminUserId,
        'admin',
        adminNotificationTitle,
        adminNotificationMessage,
        'STATUS_CHANGE',
        estimateId
      );
      
      if (global.sendAdminNotification) {
        const notification = {
          type: 'STATUS_CHANGE',
          id: Date.now(),
          estimate_number: estimateNumber,
          old_status: oldStatus,
          new_status: estimate_status,
          customer_name: customerName,
          salesperson_id: salespersonId,
          timestamp: new Date().toISOString(),
          message: adminNotificationMessage,
          action_by: 'customer'
        };
        global.sendAdminNotification(notification);
        console.log('Notification sent to admin:', notification.message);
      }
      
      if (customerId) {
        const customerNotificationTitle = `Estimate ${estimate_status.toUpperCase()}`;
        const customerNotificationMessage = `Your estimate #${estimateNumber} has been ${estimate_status.toLowerCase()}`;
        
        await insertNotification(
          customerId,
          'customer',
          customerNotificationTitle,
          customerNotificationMessage,
          'STATUS_CHANGE',
          estimateId
        );
        
        if (global.sendCustomerNotification) {
          const customerNotif = {
            type: 'STATUS_CHANGE',
            id: Date.now(),
            estimate_number: estimateNumber,
            old_status: oldStatus,
            new_status: estimate_status,
            timestamp: new Date().toISOString(),
            message: customerNotificationMessage
          };
          global.sendCustomerNotification(customerId, customerNotif);
        }
      }
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

    let packImages = data.pack_images || [];
    if (typeof packImages === 'string') {
      try {
        packImages = JSON.parse(packImages);
      } catch {
        packImages = [];
      }
    }
    if (!Array.isArray(packImages)) packImages = [];
    
    const packImagesJson = JSON.stringify(packImages);

    const sql = `UPDATE estimate SET
        date=?, pcode=?, customer_name=?, customer_id=?, salesperson_id=?, source_by=?, 
        estimate_status=?, estimate_number=?, code=?, product_id=?, product_name=?, 
        metal_type=?, design_name=?, purity=?, category=?, sub_category=?, gross_weight=?, 
        stone_weight=?, stone_price=?, weight_bw=?, va_on=?, va_percent=?, wastage_weight=?, 
        total_weight_av=?, mc_on=?, mc_per_gram=?, making_charges=?, rate=?, rate_amt=?, 
        tax_percent=?, tax_amt=?, total_price=?, pricing=?, pieace_cost=?, 
        disscount_percentage=?, disscount=?, hm_charges=?, packet_barcode=?, packet_wt=?, 
        pack_images=?, updated_at = NOW()
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

    const [estimateData] = await db.query(
      "SELECT pack_images FROM estimate WHERE estimate_number = ?",
      [estimateNumber]
    );

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
    const { pdfData } = req.body;

    if (!pdfData) {
      return res.status(400).json({ message: "PDF data is required" });
    }

    const uploadDir = path.join(__dirname, '../uploads/invoices');
    await fs.mkdir(uploadDir, { recursive: true });

    const pdfBuffer = Buffer.from(pdfData, 'base64');
    const filePath = path.join(uploadDir, `${estimateNumber}.pdf`);
    await fs.writeFile(filePath, pdfBuffer);

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

// Get invoice data for PDF generation
router.get("/get-invoice/:estimate_number", async (req, res) => {
  try {
    const estNum = req.params.estimate_number;
    
    if (!estNum) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Fetching invoice data for: ${estNum}`);
    
    const [checkResult] = await db.query(
      "SELECT pdf_generated, order_number FROM estimate WHERE estimate_number = ? LIMIT 1",
      [estNum]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [results] = await db.query(
      "SELECT * FROM estimate WHERE estimate_number = ? ORDER BY estimate_id", 
      [estNum]
    );

    if (!results.length) {
      return res.status(404).json({ message: "No data found for given estimate number" });
    }

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
      mobile: results[0].customer_id,
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
    console.error("Error fetching invoice data:", err);
    res.status(500).json({ message: "Error fetching invoice data", error: err.message });
  }
});

// Get all packet records for dropdown/selection
router.get("/api/all-packets", async (req, res) => {
  try {
    const [results] = await db.query(
      "SELECT id, prefix, packet_date, packet_wt, qr_code, status FROM qr_packets WHERE status = 'Active' ORDER BY created_at DESC"
    );
    
    res.json({ 
      success: true, 
      data: results,
      message: "Packets fetched successfully" 
    });
  } catch (err) {
    console.error("Error fetching packets:", err);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch packets", 
      error: err.message 
    });
  }
});



// Add these endpoints to your existing backend routes file

// Update estimate status (with automatic order number generation when status becomes Ordered)
router.put("/update-estimate-status/:estimate_number", async (req, res) => {
  try {
    const estimateNumber = req.params.estimate_number;
    const { estimate_status } = req.body;
    
    if (!estimateNumber) {
      return res.status(400).json({ success: false, message: "Estimate number is required" });
    }
    
    if (!estimate_status) {
      return res.status(400).json({ success: false, message: "Status is required" });
    }

    console.log(`Updating estimate ${estimateNumber} to status: ${estimate_status}`);

    // Check if estimate exists and get current status
    const [checkResult] = await db.query(
      "SELECT estimate_id, estimate_status, order_number FROM estimate WHERE estimate_number = ? LIMIT 1",
      [estimateNumber]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ success: false, message: "Estimate not found" });
    }

    const currentStatus = checkResult[0].estimate_status;
    let orderNumber = checkResult[0].order_number;
    let orderDate = null;

    // If status is changing to Ordered and no order number exists, generate one
    if (estimate_status === "Ordered" && !orderNumber) {
      orderNumber = await generateOrderNumber();
      orderDate = new Date().toISOString().split('T')[0];
      console.log(`Generated order number for estimate ${estimateNumber}: ${orderNumber}`);
    }

    // Update the status
    let updateSql = "UPDATE estimate SET estimate_status = ?, updated_at = NOW()";
    const updateValues = [estimate_status];

    if (orderNumber) {
      updateSql += ", order_number = ?, order_date = ?";
      updateValues.push(orderNumber, orderDate);
    }

    updateSql += " WHERE estimate_number = ?";
    updateValues.push(estimateNumber);

    const [result] = await db.query(updateSql, updateValues);

    if (result.affectedRows === 0) {
      return res.status(500).json({ success: false, message: "Failed to update status" });
    }

    console.log(`Successfully updated estimate ${estimateNumber} to ${estimate_status}`);
    
    if (orderNumber) {
      console.log(`Order number generated: ${orderNumber}`);
    }

    res.json({ 
      success: true, 
      message: "Estimate status updated successfully",
      estimate_number: estimateNumber,
      estimate_status: estimate_status,
      order_number: orderNumber,
      order_date: orderDate
    });

  } catch (err) {
    console.error("Error updating estimate status:", err);
    res.status(500).json({ success: false, message: "Failed to update estimate status", error: err.message });
  }
});

// Update estimate with invoice details after PDF generation
router.post("/update-estimate-with-invoice", async (req, res) => {
  try {
    const { 
      estimate_number, 
      invoice_number, 
      net_amount, 
      taxable_amount, 
      tax_amount, 
      discount_amt 
    } = req.body;
    
    if (!estimate_number) {
      return res.status(400).json({ success: false, message: "Estimate number is required" });
    }
    
    if (!invoice_number) {
      return res.status(400).json({ success: false, message: "Invoice number is required" });
    }

    console.log(`Updating estimate ${estimate_number} with invoice ${invoice_number}`);

    const query = `
      UPDATE estimate 
      SET invoice_number = ?,
          net_amount = ?,
          taxable_amount = ?,
          tax_amount = ?,
          discount_amt = ?,
          pdf_generated = 1,
          updated_at = NOW()
      WHERE estimate_number = ?
    `;
    
    const [result] = await db.query(query, [
      invoice_number, 
      net_amount || null, 
      taxable_amount || null, 
      tax_amount || null, 
      discount_amt || null, 
      estimate_number
    ]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Estimate not found" });
    }
    
    console.log(`Successfully updated estimate ${estimate_number} with invoice ${invoice_number}`);
    
    res.status(200).json({ 
      success: true, 
      message: "Estimate updated with invoice details successfully",
      estimate_number: estimate_number,
      invoice_number: invoice_number
    });
  } catch (error) {
    console.error("Error updating estimate with invoice:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to update estimate with invoice details", 
      error: error.message 
    });
  }
});

// Get unique estimates with invoice numbers
router.get("/get-unique-estimates", async (req, res) => {
  try {
    console.log("Fetching unique estimates...");
    const sql = `
      SELECT e1.* FROM estimate e1
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
    console.error("Error fetching unique estimates:", err);
    res.status(500).json({ message: "Error fetching data", error: err.message });
  }
});

// Get invoice data for PDF generation (updated to include invoice_number)
router.get("/get-invoice/:estimate_number", async (req, res) => {
  try {
    const estNum = req.params.estimate_number;
    
    if (!estNum) {
      return res.status(400).json({ message: "Estimate number is required" });
    }

    console.log(`Fetching invoice data for: ${estNum}`);
    
    const [checkResult] = await db.query(
      "SELECT pdf_generated, order_number, invoice_number FROM estimate WHERE estimate_number = ? LIMIT 1",
      [estNum]
    );

    if (checkResult.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [results] = await db.query(
      "SELECT * FROM estimate WHERE estimate_number = ? ORDER BY estimate_id", 
      [estNum]
    );

    if (!results.length) {
      return res.status(404).json({ message: "No data found for given estimate number" });
    }

    // Check authorization if customer_id is provided
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
      invoice_number: results[0].invoice_number,
      total_amount: results[0].total_amount,
      taxable_amount: results[0].taxable_amount,
      tax_amount: results[0].tax_amount,
      net_amount: results[0].net_amount,
      disscount: results[0].disscount,
      customer_name: results[0].customer_name,
      mobile: results[0].customer_id,
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
      hm_charges: row.hm_charges
    }));

    res.json({ uniqueData, repeatedData });
  } catch (err) {
    console.error("Error fetching invoice data:", err);
    res.status(500).json({ message: "Error fetching invoice data", error: err.message });
  }
});



module.exports = router;