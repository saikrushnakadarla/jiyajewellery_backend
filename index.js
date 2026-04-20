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



// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/pack-images', express.static(path.join(__dirname, 'uploads', 'pack-images')));

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

// Default route
app.get('/', (req, res) => {
  res.send('Hello, Node.js project is running 🚀');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});