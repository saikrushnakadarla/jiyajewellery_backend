// index.js
const express = require('express');
const app = express();
const PORT = 5000;
const cors = require('cors');
const db = require('./db');
require('dotenv').config(); // Add this line

// Middleware
app.use(cors());
app.use(express.json());

// Import user routes
const userRoutes = require('./routes/userRoutes'); // make sure this path is correct

// Use routes
app.use('/', userRoutes);

// Default route
app.get('/', (req, res) => {
  res.send('Hello, Node.js project is running 🚀');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});