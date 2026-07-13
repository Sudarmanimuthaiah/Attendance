const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

let pool;

if (process.env.DATABASE_URL) {
  // Aiven or other cloud Postgres URL
  // Strip query parameters to prevent pg from overriding our ssl config options
  let connectionString = process.env.DATABASE_URL;
  if (connectionString.includes('?')) {
    connectionString = connectionString.split('?')[0];
  }
  pool = new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    }
  });
} else {
  // Local PostgreSQL fallback
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'attendance_hub',
    port: process.env.DB_PORT || 5432
  });
}

// Helper to execute query
async function query(sql, params) {
  // Convert MySQL-style "?" placeholders to PostgreSQL "$1, $2, ..." style
  let pgSql = sql;
  let index = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${index++}`);
  
  const res = await pool.query(pgSql, params);
  return res.rows;
}

// Initialize and seed database
async function initDatabase() {
  try {
    console.log('Initializing Database tables...');
    
    // Create employees table
    await query(`
      CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        color VARCHAR(20) NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create attendance logs table
    await query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id VARCHAR(50) PRIMARY KEY,
        date DATE NOT NULL,
        employee_id VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        time TIME NOT NULL,
        status VARCHAR(50) NOT NULL,
        remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);

    // Safely add geolocation columns to attendance_logs
    try {
      await query('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8) NULL');
    } catch (e) { /* Column already exists or error ignored */ }
    try {
      await query('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8) NULL');
    } catch (e) { /* Column already exists or error ignored */ }
    try {
      await query('ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS distance_meters INT NULL');
    } catch (e) { /* Column already exists or error ignored */ }

    // Create leaves table
    await query(`
      CREATE TABLE IF NOT EXISTS leaves (
        id VARCHAR(50) PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        leave_type VARCHAR(50) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);

    // Create holidays table
    await query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id SERIAL PRIMARY KEY,
        date DATE UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) DEFAULT 'National',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check if an admin already exists, if not, create one
    const admins = await query('SELECT * FROM employees WHERE is_admin = true');
    if (admins.length === 0) {
      console.log('No administrator found. Seeding default admin...');
      const adminId = 'EMP-000';
      const adminName = 'System Administrator';
      const adminRole = 'HR Administrator';
      const adminEmail = 'admin@company.com';
      const defaultPassword = 'adminpassword';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      const adminColor = '#6366f1'; // Indigo avatar color

      await query(
        'INSERT INTO employees (id, name, role, email, password, color, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [adminId, adminName, adminRole, adminEmail, hashedPassword, adminColor, true]
      );
      console.log('--------------------------------------------------');
      console.log(`Default Admin Account Seeded:`);
      console.log(`Employee ID: ${adminId}`);
      console.log(`Email: ${adminEmail}`);
      console.log(`Password: ${defaultPassword}`);
      console.log('--------------------------------------------------');
    } else {
      console.log('Admin account already exists.');
    }

    // Seed default holidays if empty or missing Tamil holidays (like Pongal)
    const pongalCheck = await query("SELECT COUNT(*) as count FROM holidays WHERE name LIKE '%Pongal%'");
    const hasPongal = parseInt(pongalCheck[0].count || 0) > 0;
    const holidayCount = await query('SELECT COUNT(*) as count FROM holidays');

    if (parseInt(holidayCount[0].count || 0) === 0 || !hasPongal) {
      console.log('Seeding initial Tamil Nadu / Indian holidays calendar list...');
      const currentYear = new Date().getFullYear();
      const defaultHolidays = [
        { date: `${currentYear}-01-01`, name: "New Year's Day", type: "National" },
        { date: `${currentYear}-01-15`, name: "Pongal", type: "Festival" },
        { date: `${currentYear}-01-16`, name: "Thiruvalluvar Day", type: "Festival" },
        { date: `${currentYear}-01-17`, name: "Uzhavar Thirunal", type: "Festival" },
        { date: `${currentYear}-01-26`, name: "Republic Day", type: "National" },
        { date: `${currentYear}-02-01`, name: "Thai Poosam", type: "Festival" },
        { date: `${currentYear}-03-19`, name: "Telugu New Year's Day", type: "Festival" },
        { date: `${currentYear}-03-21`, name: "Ramzan (Id-ul-Fitr)", type: "Festival" },
        { date: `${currentYear}-03-31`, name: "Mahavir Jayanti", type: "Festival" },
        { date: `${currentYear}-04-03`, name: "Good Friday", type: "Festival" },
        { date: `${currentYear}-04-14`, name: "Tamil New Year's Day / Dr. B.R. Ambedkar's Birthday", type: "Festival" },
        { date: `${currentYear}-05-01`, name: "May Day", type: "National" },
        { date: `${currentYear}-05-28`, name: "Bakrid (Idul Azha)", type: "Festival" },
        { date: `${currentYear}-06-26`, name: "Muharram", type: "Festival" },
        { date: `${currentYear}-08-15`, name: "Independence Day", type: "National" },
        { date: `${currentYear}-08-26`, name: "Milad-un-Nabi", type: "Festival" },
        { date: `${currentYear}-09-04`, name: "Krishna Jayanthi", type: "Festival" },
        { date: `${currentYear}-09-14`, name: "Vinayakar Chathurthi", type: "Festival" },
        { date: `${currentYear}-10-02`, name: "Gandhi Jayanthi", type: "National" },
        { date: `${currentYear}-10-19`, name: "Ayutha Pooja", type: "Festival" },
        { date: `${currentYear}-10-20`, name: "Vijaya Dasami", type: "Festival" },
        { date: `${currentYear}-11-08`, name: "Deepavali", type: "Festival" },
        { date: `${currentYear}-12-25`, name: "Christmas", type: "Festival" }
      ];

      for (const h of defaultHolidays) {
        try {
          await query(
            'INSERT INTO holidays (date, name, type) VALUES (?, ?, ?) ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type',
            [h.date, h.name, h.type]
          );
        } catch (err) {
          // Ignore insertion errors
        }
      }
      console.log('Holidays calendar seeded successfully with Tamil Nadu / Indian holidays list.');
    }
    
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
    console.log('Please make sure your PostgreSQL server is running and the database specified exists.');
  }
}

module.exports = {
  pool,
  query,
  initDatabase
};
