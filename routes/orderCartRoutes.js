const express = require('express');
const router = express.Router();
const db = require('../db');
const { body, validationResult } = require('express-validator');

// Add item to order cart
router.post('/add', [
    body('user_id').isInt().withMessage('Valid user ID is required'),
    body('product_id').isInt().withMessage('Valid product ID is required'),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { user_id, product_id, quantity = 1 } = req.body;

        // Check if product exists
        const [product] = await db.query(
            'SELECT * FROM product WHERE product_id = ?',
            [product_id]
        );

        if (product.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Product not found' 
            });
        }

        // Check if user exists
        const [user] = await db.query(
            'SELECT id FROM users WHERE id = ?',
            [user_id]
        );

        if (user.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Check if item already exists in order cart
        const [existingOrderItem] = await db.query(
            'SELECT order_cart_id, quantity FROM order_cart WHERE user_id = ? AND product_id = ?',
            [user_id, product_id]
        );

        if (existingOrderItem.length > 0) {
            // Update quantity if item exists
            const newQuantity = existingOrderItem[0].quantity + quantity;
            await db.query(
                'UPDATE order_cart SET quantity = ? WHERE order_cart_id = ?',
                [newQuantity, existingOrderItem[0].order_cart_id]
            );
            
            return res.json({
                success: true,
                message: 'Order cart updated successfully',
                order_cart_id: existingOrderItem[0].order_cart_id,
                quantity: newQuantity
            });
        } else {
            // Insert new item
            const [result] = await db.query(
                'INSERT INTO order_cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
                [user_id, product_id, quantity]
            );

            return res.json({
                success: true,
                message: 'Product added to order cart successfully',
                order_cart_id: result.insertId,
                quantity: quantity
            });
        }
    } catch (error) {
        console.error('Error adding to order cart:', error);
        
        if (error.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid user_id or product_id' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Get order cart items for a user
router.get('/user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get order cart items with product details
        const [orderItems] = await db.query(`
            SELECT 
                oc.order_cart_id,
                oc.user_id,
                oc.product_id,
                oc.quantity,
                oc.added_at,
                p.product_name,
                p.barcode,
                p.gross_wt,
                p.net_wt,
                p.stone_wt,
                p.metal_type,
                p.metal_type_id,
                p.purity,
                p.purity_id,
                p.design,
                p.design_id,
                p.stone_price,
                p.making_charges,
                p.tax_percent,
                p.tax_amt,
                p.total_price,
                p.rate,
                p.rate_amt,
                p.hm_charges,
                p.disscount_percentage,
                p.disscount,
                p.images,
                p.status,
                p.category_id
            FROM order_cart oc
            JOIN product p ON oc.product_id = p.product_id
            WHERE oc.user_id = ?
            ORDER BY oc.added_at DESC
        `, [userId]);

        // Format the response with all product details
        const formattedOrderItems = orderItems.map(item => ({
            order_cart_id: item.order_cart_id,
            user_id: item.user_id,
            product_id: item.product_id,
            quantity: item.quantity,
            added_at: item.added_at,
            product: {
                product_id: item.product_id,
                product_name: item.product_name,
                barcode: item.barcode,
                gross_wt: parseFloat(item.gross_wt),
                net_wt: parseFloat(item.net_wt),
                stone_wt: parseFloat(item.stone_wt),
                metal_type: item.metal_type,
                metal_type_id: item.metal_type_id,
                purity: item.purity,
                purity_id: item.purity_id,
                design: item.design,
                design_id: item.design_id,
                stone_price: parseFloat(item.stone_price),
                making_charges: parseFloat(item.making_charges),
                tax_percent: parseFloat(item.tax_percent),
                tax_amt: parseFloat(item.tax_amt),
                total_price: parseFloat(item.total_price),
                rate: parseFloat(item.rate),
                rate_amt: parseFloat(item.rate_amt),
                hm_charges: parseFloat(item.hm_charges),
                disscount_percentage: parseFloat(item.disscount_percentage),
                disscount: parseFloat(item.disscount),
                images: item.images ? JSON.parse(item.images) : [],
                status: item.status,
                category_id: item.category_id
            }
        }));

        res.json({
            success: true,
            order_cart_items: formattedOrderItems,
            count: orderItems.length
        });
    } catch (error) {
        console.error('Error fetching order cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Update order cart item quantity
router.put('/update/:orderCartId', [
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const orderCartId = req.params.orderCartId;
        const { quantity } = req.body;

        const [result] = await db.query(
            'UPDATE order_cart SET quantity = ? WHERE order_cart_id = ?',
            [quantity, orderCartId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order cart item not found' 
            });
        }

        res.json({
            success: true,
            message: 'Order cart updated successfully'
        });
    } catch (error) {
        console.error('Error updating order cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Remove item from order cart
router.delete('/remove/:orderCartId', async (req, res) => {
    try {
        const orderCartId = req.params.orderCartId;

        const [result] = await db.query(
            'DELETE FROM order_cart WHERE order_cart_id = ?',
            [orderCartId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order cart item not found' 
            });
        }

        res.json({
            success: true,
            message: 'Item removed from order cart'
        });
    } catch (error) {
        console.error('Error removing from order cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Clear user's order cart
router.delete('/clear/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const [result] = await db.query(
            'DELETE FROM order_cart WHERE user_id = ?',
            [userId]
        );

        res.json({
            success: true,
            message: 'Order cart cleared successfully',
            removed_items: result.affectedRows
        });
    } catch (error) {
        console.error('Error clearing order cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Get order cart summary
router.get('/summary/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const [summary] = await db.query(`
            SELECT 
                COUNT(*) as item_count,
                SUM(oc.quantity) as total_quantity,
                SUM(p.total_price * oc.quantity) as subtotal
            FROM order_cart oc
            JOIN product p ON oc.product_id = p.product_id
            WHERE oc.user_id = ?
        `, [userId]);

        res.json({
            success: true,
            summary: {
                item_count: summary[0].item_count || 0,
                total_quantity: summary[0].total_quantity || 0,
                subtotal: summary[0].subtotal || 0
            }
        });
    } catch (error) {
        console.error('Error getting order cart summary:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Check if product is in user's order cart
router.get('/check/:userId/:productId', async (req, res) => {
    try {
        const { userId, productId } = req.params;

        const [orderItem] = await db.query(
            'SELECT order_cart_id FROM order_cart WHERE user_id = ? AND product_id = ?',
            [userId, productId]
        );

        res.json({
            success: true,
            inOrderCart: orderItem.length > 0,
            orderItem: orderItem.length > 0 ? orderItem[0] : null
        });
    } catch (error) {
        console.error('Error checking order cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Create order from order cart items
router.post('/create-order', async (req, res) => {
    try {
        const { user_id } = req.body;

        if (!user_id) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        // Get all items from order cart with product details
        const [orderItems] = await db.query(`
            SELECT 
                oc.*,
                p.*
            FROM order_cart oc
            JOIN product p ON oc.product_id = p.product_id
            WHERE oc.user_id = ?
        `, [user_id]);

        if (orderItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Order cart is empty'
            });
        }

        // Get user details
        const [user] = await db.query(
            'SELECT id, name FROM users WHERE id = ?',
            [user_id]
        );

        if (user.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Calculate totals
        let totalAmount = 0;
        let taxableAmount = 0;
        let taxAmount = 0;

        const repeatedData = orderItems.map(item => {
            const itemTotal = parseFloat(item.total_price) * item.quantity;
            const itemTax = parseFloat(item.tax_amt) * item.quantity;
            
            totalAmount += itemTotal;
            taxableAmount += itemTotal;
            taxAmount += itemTax;

            return {
                product_id: item.product_id,
                product_name: item.product_name,
                barcode: item.barcode || '',
                metal_type: item.metal_type || 'Gold',
                design: item.design || '',
                design_name: item.design || '',
                purity: item.purity || '22K',
                gross_weight: parseFloat(item.gross_wt) || 0,
                net_wt: parseFloat(item.net_wt) || 0,
                stone_weight: parseFloat(item.stone_wt) || 0,
                stone_price: parseFloat(item.stone_price) || 0,
                making_charges: parseFloat(item.making_charges) || 0,
                tax_percent: parseFloat(item.tax_percent) || 0,
                tax_amt: parseFloat(item.tax_amt) || 0,
                rate: parseFloat(item.rate) || 0,
                total_price: parseFloat(item.total_price) || 0,
                images: item.images || [],
                customer_id: user_id,
                customer_name: user[0].name,
                quantity: item.quantity,
                estimate_status: 'Ordered',
                source_by: 'customer',
                date: new Date().toISOString().split('T')[0],
                order_date: new Date().toISOString().split('T')[0],
                pcode: item.pcode || '',
                category: item.category || '',
                sub_category: item.sub_category || '',
                salesperson_id: '',
                weight_bw: 0,
                va_on: '',
                va_percent: 0,
                wastage_weight: 0,
                msp_va_percent: 0,
                msp_wastage_weight: 0,
                total_weight_av: parseFloat(item.gross_wt) || 0,
                mc_on: '',
                mc_per_gram: 0,
                rate_amt: parseFloat(item.total_price) || 0,
                pricing: 'standard',
                pieace_cost: parseFloat(item.total_price) || 0,
                disscount_percentage: 0,
                disscount: 0,
                hm_charges: 0,
                total_amount: itemTotal,
                taxable_amount: itemTotal,
                tax_amount: itemTax,
                net_amount: itemTotal + itemTax,
                original_total_price: parseFloat(item.total_price) || 0,
                opentag_id: 0,
                qty: item.quantity
            };
        });

        const uniqueData = {
            customer_id: user_id,
            customer_name: user[0].name,
            order_date: new Date().toISOString().split('T')[0],
            estimate_status: 'Ordered',
            source_by: 'customer',
            total_amount: totalAmount,
            taxable_amount: taxableAmount,
            tax_amount: taxAmount,
            net_amount: totalAmount + taxAmount,
            disscount: 0,
            disscount_percentage: 0,
            hm_charges: 0
        };

        // Generate estimate number
        const estimateNumber = 'EST-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

        // Insert into estimates table
        const [estimateResult] = await db.query(
            `INSERT INTO estimates (
                estimate_number, customer_id, customer_name, order_date, 
                estimate_status, source_by, total_amount, taxable_amount, 
                tax_amount, net_amount, disscount, disscount_percentage, hm_charges
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                estimateNumber, uniqueData.customer_id, uniqueData.customer_name,
                uniqueData.order_date, uniqueData.estimate_status, uniqueData.source_by,
                uniqueData.total_amount, uniqueData.taxable_amount, uniqueData.tax_amount,
                uniqueData.net_amount, uniqueData.disscount, uniqueData.disscount_percentage,
                uniqueData.hm_charges
            ]
        );

        const estimateId = estimateResult.insertId;

        // Insert each product into estimate_products table
        for (const product of repeatedData) {
            await db.query(
                `INSERT INTO estimate_products (
                    estimate_id, product_id, product_name, barcode, metal_type, design,
                    design_name, purity, gross_weight, net_wt, stone_weight, stone_price,
                    making_charges, tax_percent, tax_amt, rate, total_price, images,
                    customer_id, customer_name, quantity, estimate_status, source_by,
                    date, order_date, pcode, category, sub_category, salesperson_id,
                    weight_bw, va_on, va_percent, wastage_weight, msp_va_percent,
                    msp_wastage_weight, total_weight_av, mc_on, mc_per_gram, rate_amt,
                    pricing, pieace_cost, disscount_percentage, disscount, hm_charges,
                    total_amount, taxable_amount, tax_amount, net_amount,
                    original_total_price, opentag_id, qty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    estimateId, product.product_id, product.product_name, product.barcode,
                    product.metal_type, product.design, product.design_name, product.purity,
                    product.gross_weight, product.net_wt, product.stone_weight, product.stone_price,
                    product.making_charges, product.tax_percent, product.tax_amt, product.rate,
                    product.total_price, JSON.stringify(product.images), product.customer_id,
                    product.customer_name, product.quantity, product.estimate_status,
                    product.source_by, product.date, product.order_date, product.pcode,
                    product.category, product.sub_category, product.salesperson_id,
                    product.weight_bw, product.va_on, product.va_percent, product.wastage_weight,
                    product.msp_va_percent, product.msp_wastage_weight, product.total_weight_av,
                    product.mc_on, product.mc_per_gram, product.rate_amt, product.pricing,
                    product.pieace_cost, product.disscount_percentage, product.disscount,
                    product.hm_charges, product.total_amount, product.taxable_amount,
                    product.tax_amount, product.net_amount, product.original_total_price,
                    product.opentag_id, product.qty
                ]
            );
        }

        // Clear the order cart after successful order creation
        await db.query('DELETE FROM order_cart WHERE user_id = ?', [user_id]);

        res.json({
            success: true,
            message: 'Order created successfully',
            estimate_number: estimateNumber,
            estimate_id: estimateId
        });

    } catch (error) {
        console.error('Error creating order from cart:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
});

module.exports = router;