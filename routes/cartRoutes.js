const express = require('express');
const router = express.Router();
const db = require('../db'); // Adjust based on your DB connection
const { body, validationResult } = require('express-validator');

// Add item to cart
router.post('/add', [
    body('user_id').isInt().withMessage('Valid user ID is required'),
    body('product_id').isInt().withMessage('Valid product ID is required'),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
    try {
        // Validate request
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { user_id, product_id, quantity = 1 } = req.body;

        // Check if product exists - UPDATED TABLE NAME
        const [product] = await db.query(
            'SELECT product_id FROM product WHERE product_id = ?',
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

        // Check if item already exists in cart
        const [existingCartItem] = await db.query(
            'SELECT cart_id, quantity FROM cart WHERE user_id = ? AND product_id = ?',
            [user_id, product_id]
        );

        if (existingCartItem.length > 0) {
            // Update quantity if item exists
            const newQuantity = existingCartItem[0].quantity + quantity;
            await db.query(
                'UPDATE cart SET quantity = ? WHERE cart_id = ?',
                [newQuantity, existingCartItem[0].cart_id]
            );
            
            return res.json({
                success: true,
                message: 'Cart updated successfully',
                cart_id: existingCartItem[0].cart_id,
                quantity: newQuantity
            });
        } else {
            // Insert new item
            const [result] = await db.query(
                'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
                [user_id, product_id, quantity]
            );

            return res.json({
                success: true,
                message: 'Product added to cart successfully',
                cart_id: result.insertId,
                quantity: quantity
            });
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        
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

// Get cart items for a user - UPDATED TABLE NAME
router.get('/user/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        // Get cart items with product details
        const [cartItems] = await db.query(`
            SELECT 
                c.cart_id,
                c.user_id,
                c.product_id,
                c.quantity,
                c.added_at,
                p.product_name,
                p.barcode,
                p.gross_wt,
                p.net_wt,
                p.metal_type,
                p.purity,
                p.design,
                p.stone_price,
                p.making_charges,
                p.tax_amt,
                p.total_price,
                p.images
            FROM cart c
            JOIN product p ON c.product_id = p.product_id
            WHERE c.user_id = ?
            ORDER BY c.added_at DESC
        `, [userId]);

        // Format the response
        const formattedCartItems = cartItems.map(item => ({
            cart_id: item.cart_id,
            user_id: item.user_id,
            product_id: item.product_id,
            quantity: item.quantity,
            added_at: item.added_at,
            product: {
                product_name: item.product_name,
                barcode: item.barcode,
                gross_wt: item.gross_wt,
                net_wt: item.net_wt,
                metal_type: item.metal_type,
                purity: item.purity,
                design: item.design,
                stone_price: parseFloat(item.stone_price),
                making_charges: parseFloat(item.making_charges),
                tax_amt: parseFloat(item.tax_amt),
                total_price: parseFloat(item.total_price),
                images: item.images ? JSON.parse(item.images) : []
            }
        }));

        res.json({
            success: true,
            cart_items: formattedCartItems,
            count: cartItems.length
        });
    } catch (error) {
        console.error('Error fetching cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Update cart item quantity
router.put('/update/:cartId', [
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const cartId = req.params.cartId;
        const { quantity } = req.body;

        const [result] = await db.query(
            'UPDATE cart SET quantity = ? WHERE cart_id = ?',
            [quantity, cartId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Cart item not found' 
            });
        }

        res.json({
            success: true,
            message: 'Cart updated successfully'
        });
    } catch (error) {
        console.error('Error updating cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Remove item from cart
router.delete('/remove/:cartId', async (req, res) => {
    try {
        const cartId = req.params.cartId;

        const [result] = await db.query(
            'DELETE FROM cart WHERE cart_id = ?',
            [cartId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Cart item not found' 
            });
        }

        res.json({
            success: true,
            message: 'Item removed from cart'
        });
    } catch (error) {
        console.error('Error removing from cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Clear user's cart
router.delete('/clear/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const [result] = await db.query(
            'DELETE FROM cart WHERE user_id = ?',
            [userId]
        );

        res.json({
            success: true,
            message: 'Cart cleared successfully',
            removed_items: result.affectedRows
        });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

// Get cart summary (count and total) - UPDATED TABLE NAME
router.get('/summary/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;

        const [summary] = await db.query(`
            SELECT 
                COUNT(*) as item_count,
                SUM(c.quantity) as total_quantity,
                SUM(p.total_price * c.quantity) as subtotal
            FROM cart c
            JOIN product p ON c.product_id = p.product_id
            WHERE c.user_id = ?
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
        console.error('Error getting cart summary:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error',
            error: error.message 
        });
    }
});

module.exports = router;