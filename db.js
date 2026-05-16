const mysql = require("mysql2/promise");

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "jiyajewellery",
  port:3306 
  // port:4306
});

module.exports = db;