// index.js
const express = require('express');
const app = express();
const path = require('path'); 
const PORT = 5000;
const cors = require('cors');
const db = require('./db');
require('dotenv').config(); // Add this line

// Middleware
app.use(cors());
app.use(express.json());

// Store active SSE connections
global.adminSSEConnections = new Set();

global.customerSSEConnections = new Map(); // Map<customerId, Set<connections>>

// SSE endpoint for admin notifications
app.get('/api/admin-notifications', (req, res) => {
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to notification stream' })}\n\n`);
  
  // Store connection
  global.adminSSEConnections.add(res);
  
  // Remove connection when client closes
  req.on('close', () => {
    global.adminSSEConnections.delete(res);
    console.log('SSE connection closed. Active connections:', global.adminSSEConnections.size);
  });
  
  // Keep connection alive with heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      return; 
    }
    res.write(`: heartbeat\n\n`);
  }, 30000);
  
  req.on('close', () => clearInterval(heartbeat));
});



// SSE endpoint for customer notifications
app.get('/api/customer-notifications/:customerId', (req, res) => {
  const { customerId } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to customer notification stream' })}\n\n`);
  
  // Initialize Set for this customer if not exists
  if (!global.customerSSEConnections.has(customerId)) {
    global.customerSSEConnections.set(customerId, new Set());
  }
  
  // Store connection
  global.customerSSEConnections.get(customerId).add(res);
  
  console.log(`Customer ${customerId} connected to SSE. Active customer connections:`, 
    Array.from(global.customerSSEConnections.entries()).map(([id, conns]) => `${id}: ${conns.size}`));
  
  // Remove connection when client closes
  req.on('close', () => {
    if (global.customerSSEConnections.has(customerId)) {
      global.customerSSEConnections.get(customerId).delete(res);
      if (global.customerSSEConnections.get(customerId).size === 0) {
        global.customerSSEConnections.delete(customerId);
      }
    }
    console.log(`Customer ${customerId} SSE connection closed`);
  });
  
  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      return;
    }
    res.write(`: heartbeat\n\n`);
  }, 30000);
  
  req.on('close', () => clearInterval(heartbeat));
});


// Helper function to send notification to all admin clients
function sendAdminNotification(notification) {
  const message = `data: ${JSON.stringify(notification)}\n\n`;
  global.adminSSEConnections.forEach(client => {
    try {
      if (!client.writableEnded) {
        client.write(message);
      }
    } catch (err) {
      console.error('Error sending notification:', err);
    }
  });
}



// Helper function to send notification to specific customer
function sendCustomerNotification(customerId, notification) {
  const message = `data: ${JSON.stringify(notification)}\n\n`;
  
  if (global.customerSSEConnections.has(customerId)) {
    global.customerSSEConnections.get(customerId).forEach(client => {
      try {
        if (!client.writableEnded) {
          client.write(message);
        }
      } catch (err) {
        console.error(`Error sending notification to customer ${customerId}:`, err);
      }
    });
    console.log(`Notification sent to customer ${customerId}: ${notification.title}`);
  } else {
    console.log(`Customer ${customerId} not connected to SSE`);
  }
}

// Make helper available globally
global.sendAdminNotification = sendAdminNotification;

global.sendCustomerNotification = sendCustomerNotification;

// Serve static files from uploads directory
// Serve static files from uploads directory with proper caching headers
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

app.use('/pack-images', express.static(path.join(__dirname, 'uploads', 'pack-images'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Import user routes
const userRoutes = require('./routes/userRoutes'); 
const purityRoutes = require('./routes/purityRoutes');
const metalTypeRoutes = require('./routes/metalTypeRoutes');
const designMasterRoutes = require('./routes/designMasterRoutes');
const categoryRoutes = require('./routes/categoryRoutes'); 
const productRoutes = require('./routes/productRoutes');
const estimateRoutes = require('./routes/estimateRoutes');
const ratesRoutes = require('./routes/ratesRoutes');
const cartRoutes = require('./routes/cartRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const companyRoutes = require('./routes/companyInfoRoutes');
const visitLogsRoutes = require('./routes/visitRoutes');
const loanAmountRoutes = require('./routes/loanAmountRoutes');
const leaveManagementRoutes = require('./routes/leavemanagementRoutes');
const visitLogsScheduleRoutes = require('./routes/visitLogSchedule');
const qrPacketsRoutes = require('./routes/qrpacketcodeRoutes');
const screenshotProtectionRoutes = require('./routes/screenshotProtectionRoutes');
const orderCartRoutes = require('./routes/orderCartRoutes');
const passwordResetRoutes = require('./routes/passwordResetRoutes');





// Use routes
app.use('/', userRoutes);
app.use('/', purityRoutes);
app.use('/', ratesRoutes);
app.use('/', metalTypeRoutes);
app.use('/', designMasterRoutes);
app.use('/', categoryRoutes);
app.use('/', productRoutes);
app.use('/', estimateRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/cart', cartRoutes);
app.use('/', companyRoutes);
app.use('/visit-logs', visitLogsRoutes);
app.use('/', loanAmountRoutes);
// Use routes
app.use('/', leaveManagementRoutes);


app.use('/api/visit-logs-schedule', visitLogsScheduleRoutes);

app.use('/', qrPacketsRoutes);


// Add this line with your other route registrations
app.use('/api/order-cart', orderCartRoutes);


app.use( "/", screenshotProtectionRoutes);

app.use('/', passwordResetRoutes);

// Default route
app.get('/', (req, res) => {
  res.send('Hello, Node.js project is running 🚀');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});