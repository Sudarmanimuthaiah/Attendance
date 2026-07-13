const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey123_attendancehub';

// Middlewares
app.use(cors());
app.use(express.json());

// Initialize Database Tables
db.initDatabase();

// --- Authentication Middleware ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token missing' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Middleware to check if user is admin
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Permission denied: Administrator access required.' });
  }
  next();
}

// --- API ROUTES ---

// 1. Login Endpoint
app.post('/api/auth/login', async (req, res) => {
  const { employeeId, password, isAdminLogin } = req.body;

  try {
    if (!employeeId || !password) {
      return res.status(400).json({ error: 'Please provide all credentials.' });
    }

    // Find employee by ID
    const users = await db.query('SELECT * FROM employees WHERE id = ?', [employeeId.toUpperCase()]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid Credentials.' });
    }

    const user = users[0];

    // Check if roles match
    if (isAdminLogin && !user.is_admin) {
      return res.status(403).json({ error: 'Access Denied: Not an administrator account.' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid Credentials.' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, email: user.email, isAdmin: !!user.is_admin },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email,
        color: user.color,
        isAdmin: !!user.is_admin
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Get Current User Info
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const users = await db.query('SELECT id, name, role, email, color, is_admin FROM employees WHERE id = ?', [req.user.id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = users[0];
    res.json({
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
      color: user.color,
      isAdmin: !!user.is_admin
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching user details' });
  }
});

// 3. Employee Directory CRUD
// GET all employees (Admin only)
app.get('/api/employees', authenticateToken, async (req, res) => {
  try {
    // If not admin, return error
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const list = await db.query('SELECT id, name, role, email, color, is_admin, created_at FROM employees ORDER BY name ASC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching directory' });
  }
});

// POST Add new employee (Admin only)
app.post('/api/employees', authenticateToken, requireAdmin, async (req, res) => {
  const { id, name, role, email, password, color } = req.body;

  try {
    if (!id || !name || !role || !email || !password) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    const employeeId = id.toUpperCase().trim();

    // Check if ID exists
    const existingId = await db.query('SELECT id FROM employees WHERE id = ?', [employeeId]);
    if (existingId.length > 0) {
      return res.status(400).json({ error: `Employee ID ${employeeId} already exists.` });
    }

    // Check if email exists
    const existingEmail = await db.query('SELECT email FROM employees WHERE email = ?', [email.trim()]);
    if (existingEmail.length > 0) {
      return res.status(400).json({ error: `Email address ${email} is already registered.` });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const avatarColor = color || `hsl(${Math.floor(Math.random() * 360)}, 65%, 45%)`;

    await db.query(
      'INSERT INTO employees (id, name, role, email, password, color, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [employeeId, name.trim(), role.trim(), email.trim().toLowerCase(), hashedPassword, avatarColor, false]
    );

    res.status(201).json({ message: 'Employee added successfully', id: employeeId });
  } catch (err) {
    console.error('Error adding employee:', err);
    res.status(500).json({ error: 'Server error creating profile' });
  }
});

// PUT Update employee details (Admin only)
app.put('/api/employees/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, role, email, password } = req.body;

  try {
    if (!name || !role || !email) {
      return res.status(400).json({ error: 'Name, Role, and Email are required.' });
    }

    // Verify employee exists
    const target = await db.query('SELECT * FROM employees WHERE id = ?', [id]);
    if (target.length === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    // Check email uniqueness (excluding current employee)
    const duplicateEmail = await db.query('SELECT id FROM employees WHERE email = ? AND id != ?', [email.trim(), id]);
    if (duplicateEmail.length > 0) {
      return res.status(400).json({ error: 'Email is already in use by another user.' });
    }

    let updateQuery = 'UPDATE employees SET name = ?, role = ?, email = ?';
    const params = [name.trim(), role.trim(), email.trim().toLowerCase()];

    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += ', password = ?';
      params.push(hashedPassword);
    }

    updateQuery += ' WHERE id = ?';
    params.push(id);

    await db.query(updateQuery, params);
    res.json({ message: 'Employee profile updated successfully' });

  } catch (err) {
    console.error('Error updating employee:', err);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

// DELETE remove employee (Admin only)
app.delete('/api/employees/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Access Denied: You cannot delete your own logged-in admin account.' });
    }

    const target = await db.query('SELECT name FROM employees WHERE id = ?', [id]);
    if (target.length === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    await db.query('DELETE FROM employees WHERE id = ?', [id]);
    res.json({ message: `Successfully removed employee ${target[0].name}.` });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: 'Server error removing profile' });
  }
});


// 4. Attendance Marking & Logs
// GET list of employees selector for attendance (Admin sees all, Employee sees self)
app.get('/api/attendance/selector-list', authenticateToken, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      // Return all employees
      const list = await db.query('SELECT id, name, role, color FROM employees ORDER BY name ASC');
      res.json(list);
    } else {
      // Employee only sees themselves
      const list = await db.query('SELECT id, name, role, color FROM employees WHERE id = ?', [req.user.id]);
      res.json(list);
    }
  } catch (err) {
    res.status(500).json({ error: 'Error fetching selector list' });
  }
});

// GET today's logs for a given employee (or all today logs if no employee specified & requester is admin)
app.get('/api/attendance/today', authenticateToken, async (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const { employeeId } = req.query;

  try {
    let sql = 'SELECT * FROM attendance_logs WHERE date = ?';
    const params = [todayStr];

    if (employeeId) {
      // If requesting a specific employee, anyone authenticated can view (if it matches their ID or they are admin)
      if (!req.user.isAdmin && employeeId.toUpperCase() !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      sql += ' AND employee_id = ?';
      params.push(employeeId.toUpperCase());
    } else if (!req.user.isAdmin) {
      // Employee requesting global today logs - force filter by their own ID
      sql += ' AND employee_id = ?';
      params.push(req.user.id);
    }

    const logs = await db.query(sql, params);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching today status' });
  }
});
// Office target Geolocation parameters (Chennai default)
const OFFICE_LAT = 13.0827;
const OFFICE_LON = 80.2707;

// Haversine distance calculator
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return Math.round(R * c); // in metres
}

// POST Mark check-in/out (with Geolocation)
app.post('/api/attendance/mark', authenticateToken, async (req, res) => {
  const { employeeId, action, status, remarks, latitude, longitude } = req.body;

  try {
    if (!employeeId || !action || !status) {
      return res.status(400).json({ error: 'Missing required parameters.' });
    }

    const empId = employeeId.toUpperCase().trim();

    // Check permission: employee can only mark for themselves, admin can mark for anyone
    if (!req.user.isAdmin && empId !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You can only log your own attendance.' });
    }

    // Verify employee exists
    const empList = await db.query('SELECT name FROM employees WHERE id = ?', [empId]);
    if (empList.length === 0) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const logId = 'L-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    // Geolocation parsing
    let lat = null;
    let lon = null;
    let distance = null;

    if (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null) {
      lat = parseFloat(latitude);
      lon = parseFloat(longitude);
      if (!isNaN(lat) && !isNaN(lon)) {
        distance = getHaversineDistance(lat, lon, OFFICE_LAT, OFFICE_LON);
      }
    }

    // Add log
    await db.query(
      'INSERT INTO attendance_logs (id, date, employee_id, action, time, status, remarks, latitude, longitude, distance_meters) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [logId, todayStr, empId, action, timeStr, status, remarks || '', lat, lon, distance]
    );

    res.status(201).json({
      message: `Successfully marked ${action} for ${empList[0].name}.`,
      log: { id: logId, date: todayStr, employeeId: empId, action, time: timeStr, status, remarks, latitude: lat, longitude: lon, distance_meters: distance }
    });

  } catch (err) {
    console.error('Error logging attendance:', err);
    res.status(500).json({ error: 'Server error marking attendance' });
  }
});
// GET Attendance History Reports (Admin sees all, Employee sees only self)
app.get('/api/attendance/history', authenticateToken, async (req, res) => {
  try {
    let sql = `
      SELECT l.id, l.date, l.employee_id, l.action, l.time, l.status, l.remarks, e.name, e.role, e.color
      FROM attendance_logs l
      JOIN employees e ON l.employee_id = e.id
    `;
    const params = [];
    const conditions = [];

    // Filter by own ID if employee
    if (!req.user.isAdmin) {
      conditions.push('l.employee_id = ?');
      params.push(req.user.id);
    }

    // Apply query filters
    const { search, status, startDate, endDate } = req.query;

    if (search && search.trim() !== '') {
      if (req.user.isAdmin) {
        conditions.push('(e.name LIKE ? OR l.employee_id LIKE ? OR l.remarks LIKE ?)');
        const likeVal = `%${search.trim()}%`;
        params.push(likeVal, likeVal, likeVal);
      } else {
        conditions.push('l.remarks LIKE ?');
        params.push(`%${search.trim()}%`);
      }
    }

    if (status && status !== 'All') {
      conditions.push('l.status = ?');
      params.push(status);
    }

    if (startDate) {
      conditions.push('l.date >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('l.date <= ?');
      params.push(endDate);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Order chronological descending (latest date first, then earliest check-in time first)
    sql += ' ORDER BY l.date DESC, l.time ASC';

    const logs = await db.query(sql, params);
    res.json(logs);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Server error fetching history' });
  }
});

// GET Dashboard Stats Summary
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];

  try {
    if (req.user.isAdmin) {
      // --- ADMIN PORTAL STATS ---
      // Get total employees
      const empCountRes = await db.query('SELECT COUNT(*) as count FROM employees');
      const totalEmployees = empCountRes[0].count;

      // Get all logs of today
      const todayLogs = await db.query(`
        SELECT l.*, e.name, e.role, e.color 
        FROM attendance_logs l
        JOIN employees e ON l.employee_id = e.id
        WHERE l.date = ?
      `, [todayStr]);

      // Calculate stats based on today's logs
      // Find checked in count (unique employees who checked in today)
      const checkedInEmpIds = new Set();
      let remoteCount = 0;
      let lateCount = 0;

      // Group logs by employee to find their FIRST check-in of the day
      const firstCheckInByEmp = {};
      todayLogs.forEach(log => {
        if (log.action === 'Check In') {
          checkedInEmpIds.add(log.employee_id);
          
          if (!firstCheckInByEmp[log.employee_id]) {
            firstCheckInByEmp[log.employee_id] = log;
          } else {
            // Check if this log is earlier
            if (log.time < firstCheckInByEmp[log.employee_id].time) {
              firstCheckInByEmp[log.employee_id] = log;
            }
          }
        }
      });

      // Calculate remote and late count from first check-ins
      Object.values(firstCheckInByEmp).forEach(log => {
        if (log.status === 'Remote') {
          remoteCount++;
        }
        
        // Late checked in (after 09:15 AM)
        const [h, m] = log.time.split(':').map(Number);
        if (h > 9 || (h === 9 && m > 15)) {
          lateCount++;
        }
      });

      const checkedInCount = checkedInEmpIds.size;
      const absentCount = Math.max(0, totalEmployees - checkedInCount);

      // Latest 5 activity today
      const recentLogs = todayLogs
        .sort((a, b) => b.time.localeCompare(a.time))
        .slice(0, 5)
        .map(log => ({
          employeeId: log.employee_id,
          name: log.name,
          role: log.role,
          color: log.color,
          action: log.action,
          time: log.time.substring(0, 5), // HH:MM
          status: log.status,
          remarks: log.remarks
        }));

      res.json({
        isAdmin: true,
        stats: {
          present: checkedInCount,
          remote: remoteCount,
          late: lateCount,
          absent: absentCount,
          total: totalEmployees
        },
        recentActivity: recentLogs
      });

    } else {
      // --- EMPLOYEE PORTAL STATS (PERSONAL STATS) ---
      // Get all logs of the logged in employee
      const myLogs = await db.query('SELECT * FROM attendance_logs WHERE employee_id = ?', [req.user.id]);
      const myCheckIns = myLogs.filter(log => log.action === 'Check In');

      const myTotalCheckIns = myCheckIns.length;
      const myRemoteCount = myCheckIns.filter(log => log.status === 'Remote').length;

      // Count late arrivals (after 09:15 AM)
      let myLateCount = 0;
      myCheckIns.forEach(log => {
        const [h, m] = log.time.split(':').map(Number);
        if (h > 9 || (h === 9 && m > 15)) {
          myLateCount++;
        }
      });

      // Total days logged by anyone in the system to calculate personal rate
      const totalSystemDaysRes = await db.query('SELECT COUNT(DISTINCT date) as count FROM attendance_logs');
      const totalSystemDays = totalSystemDaysRes[0].count || 1;

      // Count unique days employee checked in
      const uniqueDaysCheckedIn = new Set(myCheckIns.map(log => {
        if (typeof log.date === 'string') return log.date.split('T')[0];
        if (log.date instanceof Date) return log.date.toISOString().split('T')[0];
        return String(log.date).split('T')[0];
      })).size;
      const myAbsences = Math.max(0, totalSystemDays - uniqueDaysCheckedIn);

      // Today's personal logs
      const todayMyLogs = await db.query(
        'SELECT * FROM attendance_logs WHERE employee_id = ? AND date = ? ORDER BY time DESC',
        [req.user.id, todayStr]
      );

      const recentActivity = todayMyLogs.map(log => ({
        employeeId: log.employee_id,
        name: req.user.name,
        role: req.user.role,
        color: req.user.color || '#6366f1',
        action: log.action,
        time: log.time.substring(0, 5), // HH:MM
        status: log.status,
        remarks: log.remarks
      }));

      res.json({
        isAdmin: false,
        stats: {
          present: myTotalCheckIns,
          remote: myRemoteCount,
          late: myLateCount,
          absent: myAbsences,
          totalDays: totalSystemDays
        },
        recentActivity
      });
    }
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Server error fetching statistics' });
  }
});
// --- LEAVE MANAGEMENT APIs ---

// 1. Submit Leave Request
app.post('/api/leaves', authenticateToken, async (req, res) => {
  const { leaveType, startDate, endDate, reason } = req.body;
  const empId = req.user.id;

  try {
    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: 'Please provide all details for your leave request.' });
    }

    const leaveId = 'LV-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    await db.query(
      'INSERT INTO leaves (id, employee_id, leave_type, start_date, end_date, reason, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [leaveId, empId, leaveType, startDate, endDate, reason.trim(), 'Pending']
    );

    res.status(201).json({ message: 'Leave application submitted successfully.', leaveId });
  } catch (err) {
    console.error('Leave submission error:', err);
    res.status(500).json({ error: 'Server error applying for leave.' });
  }
});

// 2. Get Leave Applications (Admin sees all, Employee sees only self)
app.get('/api/leaves', authenticateToken, async (req, res) => {
  try {
    let sql = `
      SELECT l.id, l.employee_id, l.leave_type, l.start_date, l.end_date, l.reason, l.status, l.created_at, e.name, e.role, e.color
      FROM leaves l
      JOIN employees e ON l.employee_id = e.id
    `;
    const params = [];

    if (!req.user.isAdmin) {
      sql += ' WHERE l.employee_id = ?';
      params.push(req.user.id);
    }

    sql += ' ORDER BY l.created_at DESC';

    const list = await db.query(sql, params);
    res.json(list);
  } catch (err) {
    console.error('Fetch leaves error:', err);
    res.status(500).json({ error: 'Server error retrieving leaves list.' });
  }
});

// 3. Approve or Reject Leave Request (Admin only)
app.put('/api/leaves/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'Approved' or 'Rejected'

  try {
    if (!status || !['Approved', 'Rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be Approved or Rejected.' });
    }

    // Verify leave exists
    const leaves = await db.query('SELECT * FROM leaves WHERE id = ?', [id]);
    if (leaves.length === 0) {
      return res.status(404).json({ error: 'Leave request not found.' });
    }

    await db.query('UPDATE leaves SET status = ? WHERE id = ?', [status, id]);
    res.json({ message: `Leave application status successfully updated to ${status}.` });
  } catch (err) {
    console.error('Update leave error:', err);
    res.status(500).json({ error: 'Server error updating leave request.' });
  }
});


// --- HOLIDAYS APIs ---

// 1. Get Holidays
app.get('/api/holidays', authenticateToken, async (req, res) => {
  try {
    const list = await db.query('SELECT * FROM holidays ORDER BY date ASC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching holidays.' });
  }
});

// 2. Add Holiday (Admin only)
app.post('/api/holidays', authenticateToken, requireAdmin, async (req, res) => {
  const { date, name, type } = req.body;

  try {
    if (!date || !name) {
      return res.status(400).json({ error: 'Date and Name are required.' });
    }

    await db.query('INSERT INTO holidays (date, name, type) VALUES (?, ?, ?)', [date, name.trim(), type || 'National']);
    res.status(201).json({ message: 'Holiday added successfully.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A holiday on this date already exists.' });
    }
    console.error('Add holiday error:', err);
    res.status(500).json({ error: 'Server error creating holiday.' });
  }
});

// 3. Delete Holiday (Admin only)
app.delete('/api/holidays/:id', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const target = await db.query('SELECT name FROM holidays WHERE id = ?', [id]);
    if (target.length === 0) {
      return res.status(404).json({ error: 'Holiday not found.' });
    }

    await db.query('DELETE FROM holidays WHERE id = ?', [id]);
    res.json({ message: `Successfully removed holiday "${target[0].name}".` });
  } catch (err) {
    res.status(500).json({ error: 'Server error deleting holiday.' });
  }
});


// --- INTERACTIVE ANALYTICS APIs ---

app.get('/api/analytics/charts', authenticateToken, async (req, res) => {
  try {
    // 1. Monthly Check-in counts (for bar chart)
    const monthlyQuery = `
      SELECT DATE_FORMAT(date, '%b %Y') as label, COUNT(*) as count 
      FROM attendance_logs 
      WHERE action = 'Check In' 
      ${!req.user.isAdmin ? 'AND employee_id = ?' : ''}
      GROUP BY DATE_FORMAT(date, '%b %Y'), DATE_FORMAT(date, '%Y-%m')
      ORDER BY DATE_FORMAT(date, '%Y-%m') ASC
      LIMIT 12
    `;
    const monthlyParams = !req.user.isAdmin ? [req.user.id] : [];
    const monthlyLogs = await db.query(monthlyQuery, monthlyParams);

    // 2. Check-in status ratio (Office vs Remote vs Half Day)
    const statusQuery = `
      SELECT status as label, COUNT(*) as count 
      FROM attendance_logs 
      WHERE action = 'Check In'
      ${!req.user.isAdmin ? 'AND employee_id = ?' : ''}
      GROUP BY status
    `;
    const statusParams = !req.user.isAdmin ? [req.user.id] : [];
    const statusRatio = await db.query(statusQuery, statusParams);

    // 3. Late arrivals vs On-time arrivals count
    let lateQuery = '';
    let lateParams = [];

    if (req.user.isAdmin) {
      lateQuery = `
        SELECT 
          SUM(CASE WHEN HOUR(time) > 9 OR (HOUR(time) = 9 AND MINUTE(time) > 15) THEN 1 ELSE 0 END) as late,
          SUM(CASE WHEN HOUR(time) < 9 OR (HOUR(time) = 9 AND MINUTE(time) <= 15) THEN 1 ELSE 0 END) as ontime
        FROM attendance_logs
        WHERE action = 'Check In'
      `;
    } else {
      lateQuery = `
        SELECT 
          SUM(CASE WHEN HOUR(time) > 9 OR (HOUR(time) = 9 AND MINUTE(time) > 15) THEN 1 ELSE 0 END) as late,
          SUM(CASE WHEN HOUR(time) < 9 OR (HOUR(time) = 9 AND MINUTE(time) <= 15) THEN 1 ELSE 0 END) as ontime
        FROM attendance_logs
        WHERE action = 'Check In' AND employee_id = ?
      `;
      lateParams.push(req.user.id);
    }
    const lateData = await db.query(lateQuery, lateParams);
    const lateArrivals = lateData[0] || { late: 0, ontime: 0 };

    res.json({
      monthlyLogs,
      statusRatio,
      ontimeRatio: [
        { label: 'On Time', count: Number(lateArrivals.ontime || 0) },
        { label: 'Late', count: Number(lateArrivals.late || 0) }
      ]
    });

  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Server error compiling chart analytics.' });
  }
});


// --- SERVE FRONTEND STATIC FILES ---
app.use(express.static(path.join(__dirname, '../')));

// Fallback to index.html for single-page routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Attendance Hub backend server running on http://localhost:${PORT}`);
});
