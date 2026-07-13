// Safe localStorage wrapper to prevent SecurityErrors on file:// protocol or restricted environments
const safeStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn('localStorage access denied, using memory fallback.', e);
      return safeStorage.fallback[key] || null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn('localStorage access denied, using memory fallback.', e);
      safeStorage.fallback[key] = value;
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('localStorage access denied, using memory fallback.', e);
      delete safeStorage.fallback[key];
    }
  },
  fallback: {}
};

// Attendance Hub App State
let state = {
  employees: [],
  todayLogs: [],
  currentUser: JSON.parse(safeStorage.getItem('attendance_user')) || null,
  token: safeStorage.getItem('attendance_jwt') || null,
  selectedEmployeeId: null,
  activeTab: 'dashboard',
  realWeather: null,
  userCheckInTime: null,
  userCheckOutTime: null
};
// Global chart instances tracker
let chartInstances = {};
// Global calendar date tracker
let calendarDate = new Date();
// UI Headers mapping
const HEADERS = {
  dashboard: { 
    admin: { title: 'Dashboard Overview', subtitle: "Welcome  Admin! Here's today's company attendance summary." },
    employee: { title: 'Employee Dashboard', subtitle: "Hello! Welcome back to your workspace portal." }
  },
  attendance: { 
    admin: { title: 'Manage Attendance', subtitle: 'Check in or check out employees and update statuses.' },
    employee: { title: 'Mark Attendance', subtitle: 'Log your presence, location status, and remarks.' }
  },
  employees: { 
    admin: { title: 'Employee Directory', subtitle: 'Manage active employee records and profiles.' },
    employee: { title: 'Employee Directory', subtitle: 'Manage active employee records and profiles.' }
  },
  reports: { 
    admin: { title: 'Reports & History', subtitle: 'Search, filter, and export attendance spreadsheets.' },
    employee: { title: 'My Work Logs', subtitle: 'Review your complete historical attendance logs.' }
  },
  leaves: {
    admin: { title: 'Leave Management', subtitle: 'Review and approve/reject employee leave applications.' },
    employee: { title: 'Leave Requests', subtitle: 'Apply for leaves and track approval status.' }
  },
  holidays: {
    admin: { title: 'Holiday Calendar', subtitle: 'Manage corporate company holidays list.' },
    employee: { title: 'Holiday Calendar', subtitle: 'View upcoming official corporate company holidays.' }
  },
  analytics: {
    admin: { title: 'Interactive Analytics', subtitle: 'Deep dive into company presence and attendance rates.' },
    employee: { title: 'My Analytics', subtitle: 'Detailed visual report of your work statistics.' }
  }
};

// --- API Utility Function ---
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers
    });
    
    const data = await response.json().catch(() => ({}));
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP error! Status: ${response.status}`);
    }
    
    return data;
  } catch (err) {
    console.error(`API Fetch Error [${endpoint}]:`, err);
    throw err;
  }
}

// SVG initials avatar colors helper
function getInitialsColor(name) {
  const hash = [...name].reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
  return `hsl(${Math.abs(hash) % 360}, 65%, 45%)`;
}

// Toast Notification Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconSVG = '';
  if (type === 'success') {
    iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else if (type === 'danger') {
    iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  } else if (type === 'warning') {
    iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconSVG}</div>
    <div class="toast-body">${message}</div>
  `;
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 50);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

// Get check-in state today for a given employee
function getEmployeeTodayStatus(employeeId) {
  const empLogs = state.todayLogs.filter(log => log.employee_id === employeeId);
  if (empLogs.length === 0) return { state: 'Absent', time: '-', status: '-' };
  
  empLogs.sort((a, b) => a.time.localeCompare(b.time));
  const latestLog = empLogs[empLogs.length - 1];
  
  return {
    state: latestLog.action === 'Check In' ? 'Checked In' : 'Checked Out',
    time: latestLog.time.substring(0, 5),
    status: latestLog.status,
    remarks: latestLog.remarks
  };
}

// Helper to get local date ISO string (YYYY-MM-DD)
function getTodayISOString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to calculate duration in minutes between check-in and check-out
function timeDiffMinutes(time1, time2) {
  if (!time1 || !time2 || !time1.includes(':') || !time2.includes(':')) return 0;
  const [h1, m1] = time1.split(':').map(Number);
  const [h2, m2] = time2.split(':').map(Number);
  if (isNaN(h1) || isNaN(m1) || isNaN(h2) || isNaN(m2)) return 0;
  return (h2 * 60 + m2) - (h1 * 60 + m1);
}

// Fetch and render Dashboard Stats
async function updateDashboardStats() {
  if (!state.currentUser) return;

  updateGreetingBanner();
  updateLeaveBadge();

  try {
    const [todayUserLogs, todayLogs, data] = await Promise.all([
      apiFetch(`/api/attendance/today?employeeId=${state.currentUser.id}`).catch(err => {
        console.error('Failed to pre-fetch today logs for user:', err);
        return [];
      }),
      apiFetch('/api/attendance/today').catch(err => {
        console.error('Failed to pre-fetch today logs for dashboard status:', err);
        return [];
      }),
      apiFetch('/api/dashboard/stats')
    ]);
    state.todayLogs = todayLogs;
    const { stats, recentActivity } = data;

    // ---- Update Dashboard Quick Attendance Card State (Exact Template Style) ----
    const avatarEl = document.getElementById('quick-user-avatar');
    if (avatarEl) {
      avatarEl.textContent = getInitials(state.currentUser.name);
      avatarEl.style.backgroundColor = state.currentUser.color || '#6573c3';
    }

    const idNameEl = document.getElementById('quick-user-id-name');
    if (idNameEl) {
      idNameEl.textContent = `${state.currentUser.id} - ${state.currentUser.name}`;
    }

    const userCheckIn = todayUserLogs.find(l => l.action === 'Check In');
    const userCheckOut = todayUserLogs.find(l => l.action === 'Check Out');
    
    const statusTxt = document.getElementById('quick-attendance-status');
    const checkInControls = document.getElementById('quick-check-in-controls');
    const btnQuickAttendance = document.getElementById('btn-quick-attendance');

    if (userCheckIn) {
      // Parse IST time to a standard JS date object
      state.userCheckInTime = new Date(`${userCheckIn.date}T${userCheckIn.time}+05:30`);
      
      if (userCheckOut) {
        state.userCheckOutTime = new Date(`${userCheckOut.date}T${userCheckOut.time}+05:30`);
        if (statusTxt) {
          statusTxt.textContent = `Checked Out`;
          statusTxt.className = 'user-status checked-out';
        }
        if (checkInControls) checkInControls.style.display = 'none';
        if (btnQuickAttendance) {
          btnQuickAttendance.disabled = true;
          btnQuickAttendance.textContent = 'Checked Out';
          btnQuickAttendance.className = 'user-attendance-btn disabled-btn';
        }
      } else {
        state.userCheckOutTime = null;
        if (statusTxt) {
          statusTxt.textContent = `Checked In`;
          statusTxt.className = 'user-status checked-in';
        }
        if (checkInControls) checkInControls.style.display = 'none';
        if (btnQuickAttendance) {
          btnQuickAttendance.disabled = false;
          btnQuickAttendance.textContent = 'Check-out';
          btnQuickAttendance.className = 'user-attendance-btn check-out-btn';
        }
      }
    } else {
      state.userCheckInTime = null;
      state.userCheckOutTime = null;
      if (statusTxt) {
        statusTxt.textContent = 'Yet to check-in';
        statusTxt.className = 'user-status yet-to-in';
      }
      if (checkInControls) checkInControls.style.display = 'flex';
      if (btnQuickAttendance) {
        btnQuickAttendance.disabled = false;
        btnQuickAttendance.textContent = 'Check-in';
        btnQuickAttendance.className = 'user-attendance-btn check-in-btn';
      }
    }
    
    updateLiveWorkDuration();

    if (state.currentUser.isAdmin) {
      document.getElementById('lbl-present').textContent = 'Checked In Today';
      document.getElementById('lbl-remote').textContent = 'Working Remotely';
      document.getElementById('lbl-late').textContent = 'Late Checked In';
      document.getElementById('lbl-absent').textContent = 'Absent / Leave';
      
      const attendanceRate = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;

      document.getElementById('stat-present').textContent = stats.present;
      document.getElementById('stat-remote').textContent = stats.remote;
      document.getElementById('stat-late').textContent = stats.late;
      document.getElementById('stat-absent').textContent = stats.absent;

    } else {
      document.getElementById('lbl-present').textContent = 'My Total Check-ins';
      document.getElementById('lbl-remote').textContent = 'My Remote Days';
      document.getElementById('lbl-late').textContent = 'My Late Arrivals';
      document.getElementById('lbl-absent').textContent = 'My Leave / Absences';

      document.getElementById('stat-present').textContent = stats.present;
      document.getElementById('stat-remote').textContent = stats.remote;
      document.getElementById('stat-late').textContent = stats.late;
      document.getElementById('stat-absent').textContent = stats.absent;
    }

    // Render Recent logs
    const recentTbody = document.getElementById('dashboard-recent-tbody');
    recentTbody.innerHTML = '';

    if (recentActivity.length === 0) {
      recentTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 2rem;">No logs recorded today.</td></tr>`;
    } else {
      recentActivity.forEach(log => {
        renderLogTableRow(recentTbody, log);
      });
    }

  } catch (err) {
    showToast('Failed to load dashboard statistics: ' + err.message, 'danger');
  }
}

// Render a single log row
function renderLogTableRow(tbody, log) {
  const actionBadge = log.action === 'Check In' ? '<span class="badge badge-in">Check In</span>' : '<span class="badge badge-out">Check Out</span>';
  
  let statusBadge = '';
  if (log.status === 'Office') statusBadge = '<span class="badge badge-office">Office</span>';
  else if (log.status === 'Remote') statusBadge = '<span class="badge badge-remote">Remote</span>';
  else if (log.status === 'Half Day') statusBadge = '<span class="badge badge-halfday">Half Day</span>';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>
      <div class="employee-profile">
        <div class="avatar" style="background-color: ${log.color || '#475569'}">${getInitials(log.name)}</div>
        <div class="employee-meta">
          <span class="employee-name">${log.name}</span>
          <span class="employee-role">${log.role} (${log.employeeId})</span>
        </div>
      </div>
    </td>
    <td>${actionBadge}</td>
    <td style="font-variant-numeric: tabular-nums;">${log.time}</td>
    <td>${statusBadge}</td>
    <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.remarks || '-'}">
      ${log.remarks || '<span style="color:var(--text-muted)">-</span>'}
    </td>
  `;
  tbody.appendChild(tr);
}

function getInitials(name) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

// Render Employee Selector List for Marking Attendance
async function renderAttendanceSelector(searchQuery = '') {
  if (!state.currentUser) return;

  try {
    const [todayLogs, list] = await Promise.all([
      apiFetch('/api/attendance/today'),
      apiFetch('/api/attendance/selector-list')
    ]);
    state.todayLogs = todayLogs;
    
    if (state.currentUser.isAdmin) {
      document.getElementById('attendance-employee-sidebar').style.display = 'block';
      document.getElementById('marking-form-empty').style.display = 'flex';
      document.getElementById('marking-form-active').style.display = 'none';

      const container = document.getElementById('attendance-selector-list');
      container.innerHTML = '';
      
      const query = searchQuery.toLowerCase().trim();
      const filteredEmployees = list.filter(emp => 
        emp.name.toLowerCase().includes(query) || 
        emp.id.toLowerCase().includes(query) ||
        emp.role.toLowerCase().includes(query)
      );

      if (filteredEmployees.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No matching employees.</div>`;
        return;
      }

      filteredEmployees.forEach(emp => {
        const todayStatus = getEmployeeTodayStatus(emp.id);
        
        let stateClass = '';
        if (todayStatus.state === 'Checked In') stateClass = 'checked-in';
        else if (todayStatus.state === 'Checked Out') stateClass = 'checked-out';

        const card = document.createElement('div');
        card.className = `employee-select-card ${stateClass} ${state.selectedEmployeeId === emp.id ? 'selected' : ''}`;
        card.setAttribute('data-id', emp.id);
        
        card.innerHTML = `
          <div class="employee-profile">
            <div class="avatar" style="background-color: ${emp.color}">${getInitials(emp.name)}</div>
            <div class="employee-meta">
              <span class="employee-name">${emp.name}</span>
              <span class="employee-role">${emp.role} (${emp.id})</span>
            </div>
          </div>
          <div class="status-indicator" title="Current Status: ${todayStatus.state}"></div>
        `;

        card.addEventListener('click', () => {
          state.selectedEmployeeId = emp.id;
          renderAttendanceSelector(searchQuery);
          loadMarkingForm(emp);
        });

        container.appendChild(card);
      });

      if (state.selectedEmployeeId) {
        const selectedEmp = list.find(emp => emp.id === state.selectedEmployeeId);
        if (selectedEmp) loadMarkingForm(selectedEmp);
      }

    } else {
      document.getElementById('attendance-employee-sidebar').style.display = 'none';
      document.getElementById('marking-form-empty').style.display = 'none';
      document.getElementById('marking-form-active').style.display = 'block';
      
      state.selectedEmployeeId = state.currentUser.id;
      loadMarkingForm(state.currentUser);
    }
  } catch (err) {
    showToast('Failed to load selector list: ' + err.message, 'danger');
  }
}

function loadMarkingForm(employee) {
  const formActive = document.getElementById('marking-form-active');
  const formEmpty = document.getElementById('marking-form-empty');
  
  if (formEmpty) formEmpty.style.display = 'none';
  formActive.style.display = 'block';

  const avatar = document.getElementById('selected-employee-avatar');
  avatar.textContent = getInitials(employee.name);
  avatar.style.backgroundColor = employee.color || getInitialsColor(employee.name);
  document.getElementById('selected-employee-name').textContent = employee.name;
  document.getElementById('selected-employee-role').textContent = `${employee.role} | ${employee.id}`;

  document.getElementById('marking-remarks').value = '';

  const pills = document.querySelectorAll('#status-pill-group .status-pill');
  pills.forEach(p => p.classList.remove('active'));
  document.querySelector('#status-pill-group .status-pill[data-val="Office"]').classList.add('active');
}

// Render Employee Directory Table (Admin Only)
async function renderEmployeesTable(searchQuery = '') {
  if (!state.currentUser || !state.currentUser.isAdmin) return;

  const tbody = document.getElementById('employees-tbody');
  tbody.innerHTML = '';

  try {
    state.todayLogs = await apiFetch('/api/attendance/today');
    state.employees = await apiFetch('/api/employees');

    const query = searchQuery.toLowerCase().trim();
    const filtered = state.employees.filter(emp => 
      emp.name.toLowerCase().includes(query) || 
      emp.id.toLowerCase().includes(query) || 
      emp.email.toLowerCase().includes(query) ||
      emp.role.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">No employees found.</td></tr>`;
      return;
    }

    filtered.forEach(emp => {
      const todayStatus = getEmployeeTodayStatus(emp.id);
      
      let statusBadge = '<span class="badge" style="background:rgba(255,255,255,0.03);color:var(--text-muted)">Absent</span>';
      if (todayStatus.state === 'Checked In') {
        if (todayStatus.status === 'Office') statusBadge = '<span class="badge badge-in">Checked In (Office)</span>';
        else if (todayStatus.status === 'Remote') statusBadge = '<span class="badge badge-in" style="background: rgba(14, 165, 233, 0.15); color: var(--info);">Checked In (Remote)</span>';
        else statusBadge = '<span class="badge badge-in" style="background: rgba(245, 158, 11, 0.15); color: var(--warning);">Checked In (Half Day)</span>';
      } else if (todayStatus.state === 'Checked Out') {
        statusBadge = '<span class="badge badge-out">Checked Out</span>';
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="employee-profile">
            <div class="avatar" style="background-color: ${emp.color}">${getInitials(emp.name)}</div>
            <div class="employee-meta">
              <span class="employee-name">${emp.name}</span>
              <span class="employee-role">${emp.role}</span>
            </div>
          </div>
        </td>
        <td style="font-weight: 500;">${emp.id}</td>
        <td style="color: var(--text-secondary);">${emp.email}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-secondary btn-sm edit-emp-btn" data-id="${emp.id}" title="Edit Profile">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="btn btn-danger btn-sm delete-emp-btn" data-id="${emp.id}" title="Delete Profile">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </button>
          </div>
        </td>
      `;

      tr.querySelector('.edit-emp-btn').addEventListener('click', () => openEmployeeModal(emp.id));
      tr.querySelector('.delete-emp-btn').addEventListener('click', () => deleteEmployee(emp.id));

      tbody.appendChild(tr);
    });

  } catch (err) {
    showToast('Failed to load employee list: ' + err.message, 'danger');
  }
}

// Group history logs chronologically by date & employee for reports presentation
function getGroupedRecords(logs) {
  const groups = {};

  logs.forEach(log => {
    const key = `${log.date.substring(0, 10)}_${log.employee_id}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(log);
  });

  const results = [];

  for (const key in groups) {
    const groupLogs = groups[key];
    groupLogs.sort((a, b) => a.time.localeCompare(b.time));

    const date = groupLogs[0].date.substring(0, 10);
    const employeeId = groupLogs[0].employee_id;
    const name = groupLogs[0].name;
    const role = groupLogs[0].role;
    const color = groupLogs[0].color;
    
    const checkIns = [];
    const checkOuts = [];
    const remarks = [];
    let status = '';
    
    let totalMinutes = 0;
    let activeCheckIn = null;

    groupLogs.forEach(log => {
      const formattedTime = log.time.substring(0, 5);

      if (log.action === 'Check In') {
        checkIns.push(formattedTime);
        activeCheckIn = formattedTime;
        if (!status) {
          status = log.status;
        }
        
        let remStr = log.remarks || '';
        // If distance was logged, show it inside parentheses
        if (log.distance_meters !== null) {
          remStr += ` (${log.distance_meters}m from office)`;
        }
        if (remStr.trim()) {
          remarks.push(`In: ${remStr.trim()}`);
        }
      } else if (log.action === 'Check Out') {
        checkOuts.push(formattedTime);
        if (activeCheckIn) {
          const diff = timeDiffMinutes(activeCheckIn, formattedTime);
          if (diff > 0) {
            totalMinutes += diff;
          }
          activeCheckIn = null;
        }
        if (log.remarks) {
          remarks.push(`Out: ${log.remarks}`);
        }
      }
    });

    const isActive = activeCheckIn !== null;

    results.push({
      date,
      employeeId,
      name,
      role,
      color,
      checkIns,
      checkOuts,
      status: status || groupLogs[0].status,
      remarks,
      totalMinutes,
      isActive
    });
  }

  return results;
}

// Fetch and render reports table
async function renderReportsTable() {
  if (!state.currentUser) return;

  const tbody = document.getElementById('reports-tbody');
  const emptyState = document.getElementById('reports-empty');
  tbody.innerHTML = '';
  
  const searchVal = document.getElementById('report-search').value.toLowerCase().trim();
  const statusVal = document.getElementById('filter-status').value;
  const startDateVal = document.getElementById('filter-start-date').value;
  const endDateVal = document.getElementById('filter-end-date').value;

  try {
    const params = new URLSearchParams();
    if (searchVal) params.append('search', searchVal);
    if (statusVal) params.append('status', statusVal);
    if (startDateVal) params.append('startDate', startDateVal);
    if (endDateVal) params.append('endDate', endDateVal);

    const logs = await apiFetch(`/api/attendance/history?${params.toString()}`);
    const grouped = getGroupedRecords(logs);

    if (grouped.length === 0) {
      emptyState.style.display = 'flex';
      return;
    } else {
      emptyState.style.display = 'none';
    }

    grouped.forEach(rec => {
      let statusBadge = '';
      if (rec.status === 'Office') statusBadge = '<span class="badge badge-office">Office</span>';
      else if (rec.status === 'Remote') statusBadge = '<span class="badge badge-remote">Remote</span>';
      else if (rec.status === 'Half Day') statusBadge = '<span class="badge badge-halfday">Half Day</span>';

      const checkInDisp = rec.checkIns.length > 0 
        ? `<span style="font-variant-numeric: tabular-nums; font-weight: 500; font-size: 0.85rem;">${rec.checkIns.join(', ')}</span>`
        : '<span style="color:var(--text-muted); font-size: 0.85rem;">-</span>';
      
      const checkOutDisp = rec.checkOuts.length > 0 
        ? `<span style="font-variant-numeric: tabular-nums; font-weight: 500; font-size: 0.85rem;">${rec.checkOuts.join(', ')}</span>`
        : '<span style="color:var(--text-muted); font-size: 0.85rem;">-</span>';

      let durationStr = '-';
      if (rec.totalMinutes > 0) {
        const h = Math.floor(rec.totalMinutes / 60);
        const m = rec.totalMinutes % 60;
        durationStr = `${h}h ${m}m`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-variant-numeric: tabular-nums; font-weight: 500;">${formatDateString(rec.date)}</td>
        <td>
          <div class="employee-profile">
            <div class="avatar" style="background-color: ${rec.color || '#475569'}">${getInitials(rec.name)}</div>
            <div class="employee-meta">
              <span class="employee-name">${rec.name}</span>
              <span class="employee-role">${rec.role} (${rec.employeeId})</span>
            </div>
          </div>
        </td>
        <td>${checkInDisp}</td>
        <td>${checkOutDisp}</td>
        <td>${statusBadge}</td>
        <td style="font-weight: 600; font-variant-numeric: tabular-nums; color: ${rec.isActive ? 'var(--success)' : 'inherit'}">${durationStr}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${rec.remarks.join(' | ')}">
          ${rec.remarks.join(' | ') || '<span style="color:var(--text-muted)">-</span>'}
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    showToast('Failed to load reports: ' + err.message, 'danger');
  }
}

function formatDateString(dateStr) {
  if (!dateStr) return '-';
  // Strip off ISO time parts (e.g., T18:30:00.000Z) if present
  const cleanDate = String(dateStr).split('T')[0];
  const parts = cleanDate.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  const dateObj = new Date(y, m - 1, d);
  if (isNaN(dateObj.getTime())) return dateStr;
  return dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Export logs report to spreadsheet CSV
async function exportToCSV() {
  const searchVal = document.getElementById('report-search').value.toLowerCase().trim();
  const statusVal = document.getElementById('filter-status').value;
  const startDateVal = document.getElementById('filter-start-date').value;
  const endDateVal = document.getElementById('filter-end-date').value;

  try {
    const params = new URLSearchParams();
    if (searchVal) params.append('search', searchVal);
    if (statusVal) params.append('status', statusVal);
    if (startDateVal) params.append('startDate', startDateVal);
    if (endDateVal) params.append('endDate', endDateVal);

    const logs = await apiFetch(`/api/attendance/history?${params.toString()}`);
    const grouped = getGroupedRecords(logs);

    if (grouped.length === 0) {
      showToast('No logs to export!', 'danger');
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,Employee ID,Employee Name,Designation,Check In(s),Check Out(s),Status,Total Work Duration,Remarks\n";

    grouped.forEach(rec => {
      let durationStr = '-';
      if (rec.totalMinutes > 0) {
        const h = Math.floor(rec.totalMinutes / 60);
        const m = rec.totalMinutes % 60;
        durationStr = `${h}h ${m}m`;
      }

      const checkInsStr = rec.checkIns.join(' | ') || '-';
      const checkOutsStr = rec.checkOuts.join(' | ') || '-';
      const remarksJoined = rec.remarks.join(' | ');

      const row = [
        rec.date,
        rec.employeeId,
        `"${rec.name.replace(/"/g, '""')}"`,
        `"${rec.role.replace(/"/g, '""')}"`,
        `"${checkInsStr}"`,
        `"${checkOutsStr}"`,
        rec.status,
        durationStr,
        `"${remarksJoined.replace(/"/g, '""')}"`
      ].join(',');
      
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Attendance_Report_${getTodayISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Spreadsheet CSV exported successfully!', 'success');
  } catch (err) {
    showToast('Failed to export CSV: ' + err.message, 'danger');
  }
}

// Open modal for Employee CRUD setup
function openEmployeeModal(employeeId = null) {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    showToast('Permission Denied: Only Administrators can access profile configurations.', 'danger');
    return;
  }
  const modal = document.getElementById('employee-modal');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('employee-form');
  const passLabel = document.getElementById('lbl-employee-password');
  const passInput = document.getElementById('employee-password-input');
  
  form.reset();

  if (employeeId) {
    title.textContent = 'Edit Employee Profile';
    const emp = state.employees.find(e => e.id === employeeId);
    if (emp) {
      document.getElementById('employee-form-id').value = emp.id;
      document.getElementById('employee-id-input').value = emp.id;
      document.getElementById('employee-id-input').disabled = true;
      document.getElementById('employee-role-input').value = emp.role;
      document.getElementById('employee-name-input').value = emp.name;
      document.getElementById('employee-email-input').value = emp.email;
      
      passLabel.textContent = 'New Portal Password (Optional)';
      passInput.placeholder = 'Leave blank to keep current password';
      passInput.required = false;
    }
  } else {
    title.textContent = 'Add New Employee';
    document.getElementById('employee-form-id').value = '';
    document.getElementById('employee-id-input').disabled = false;
    
    passLabel.textContent = 'Portal Login Password *';
    passInput.placeholder = 'Min 6 characters';
    passInput.required = true;
  }

  modal.classList.add('show');
}

function closeEmployeeModal() {
  document.getElementById('employee-modal').classList.remove('show');
}

// Submit handler for adding/editing employees
async function handleEmployeeFormSubmit(e) {
  e.preventDefault();
  if (!state.currentUser || !state.currentUser.isAdmin) {
    showToast('Permission Denied: Only Administrators can modify employee profiles.', 'danger');
    return;
  }
  
  const formId = document.getElementById('employee-form-id').value;
  const name = document.getElementById('employee-name-input').value.trim();
  const id = document.getElementById('employee-id-input').value.trim().toUpperCase();
  const role = document.getElementById('employee-role-input').value.trim();
  const email = document.getElementById('employee-email-input').value.trim();
  const password = document.getElementById('employee-password-input').value;

  const payload = { id, name, role, email, password };

  try {
    if (formId) {
      const res = await apiFetch(`/api/employees/${formId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast(res.message, 'success');
    } else {
      const res = await apiFetch('/api/employees', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast(res.message, 'success');
    }

    closeEmployeeModal();
    await renderEmployeesTable();
    await renderAttendanceSelector();
    await updateDashboardStats();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Delete Employee Profile
async function deleteEmployee(id) {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    showToast('Permission Denied: Only Administrators can remove employee profiles.', 'danger');
    return;
  }

  const emp = state.employees.find(e => e.id === id);
  if (!emp) return;

  if (confirm(`Are you sure you want to remove employee ${emp.name} (${id})? This will permanently delete their profile and attendance logs.`)) {
    try {
      const res = await apiFetch(`/api/employees/${id}`, {
        method: 'DELETE'
      });
      
      if (state.selectedEmployeeId === id) {
        state.selectedEmployeeId = null;
      }

      showToast(res.message, 'info');
      await renderEmployeesTable();
      await renderAttendanceSelector();
      await updateDashboardStats();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
}

// Helper to disable/enable check-in buttons and show loading feedback
function setButtonLoading(isLoading) {
  const btnIn = document.getElementById('btn-check-in');
  const btnOut = document.getElementById('btn-check-out');
  if (!btnIn || !btnOut) return;
  if (isLoading) {
    btnIn.disabled = true;
    btnOut.disabled = true;
    btnIn.innerHTML = 'Processing...';
    btnOut.innerHTML = 'Processing...';
  } else {
    btnIn.disabled = false;
    btnOut.disabled = false;
    btnIn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      Check In
    `;
    btnOut.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      Check Out
    `;
  }
}

// Mark Check In / Check Out Log (incorporates GPS retrieval)
async function handleMarkAttendance(action) {
  if (!state.selectedEmployeeId) return;

  const remarks = document.getElementById('marking-remarks').value.trim();
  const activePill = document.querySelector('#status-pill-group .status-pill.active');
  const status = activePill ? activePill.getAttribute('data-val') : 'Office';

  setButtonLoading(true);

  if (status === 'Office' && action === 'Check In' && navigator.geolocation) {
    showToast('Retrieving GPS location for range verification...', 'info');
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await submitMarkRequest(action, status, remarks, latitude, longitude);
      },
      async (err) => {
        console.warn('Geolocation failed:', err);
        showToast('Location permission denied or timeout. Submitting check-in without range verification...', 'warning');
        await submitMarkRequest(action, status, remarks, null, null);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    await submitMarkRequest(action, status, remarks, null, null);
  }
}

async function submitMarkRequest(action, status, remarks, latitude, longitude) {
  try {
    const res = await apiFetch('/api/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: state.selectedEmployeeId,
        action,
        status,
        remarks,
        latitude,
        longitude
      })
    });

    document.getElementById('marking-remarks').value = '';
    
    if (res.log && res.log.distance_meters !== null) {
      const dist = res.log.distance_meters;
      if (dist <= 200) {
        showToast(`Checked In successfully! verified in office range (${dist}m away).`, 'success');
      } else {
        showToast(`Checked In! Warning: Detected outside office boundaries (${dist}m away).`, 'warning');
      }
    } else {
      showToast(res.message, 'success');
    }
    
    // Fetch and render updates in parallel!
    await Promise.all([
      renderAttendanceSelector(),
      updateDashboardStats()
    ]);
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    setButtonLoading(false);
  }
}


// Dynamic update of leave badge for Admins
async function updateLeaveBadge() {
  if (!state.currentUser || !state.currentUser.isAdmin) {
    const badge = document.getElementById('leaves-badge');
    if (badge) badge.style.display = 'none';
    return;
  }
  try {
    const list = await apiFetch('/api/leaves');
    const pendingLeavesCount = list.filter(leave => leave.status === 'Pending').length;
    const badge = document.getElementById('leaves-badge');
    if (badge) {
      if (pendingLeavesCount > 0) {
        badge.textContent = pendingLeavesCount;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
    
    // Also update alert banner inside Leave portal if active
    const alertBanner = document.getElementById('leaves-pending-alert');
    const alertText = document.getElementById('leaves-pending-alert-text');
    if (alertBanner && alertText) {
      if (pendingLeavesCount > 0) {
        alertText.textContent = `You have ${pendingLeavesCount} pending leave request${pendingLeavesCount > 1 ? 's' : ''} requiring your review and approval.`;
        alertBanner.style.display = 'flex';
      } else {
        alertBanner.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Failed to update leave badge:', err);
  }
}

// --- LEAVE MANAGEMENT PORTAL ---

async function renderLeavesTable() {
  const tbody = document.getElementById('leaves-tbody');
  const applyCard = document.getElementById('leave-apply-card');
  const actionTh = document.getElementById('leaves-th-actions');
  const title = document.getElementById('leaves-title');
  
  tbody.innerHTML = '';
  
  const isAdmin = state.currentUser.isAdmin;
  
  if (isAdmin) {
    applyCard.style.display = 'none';
    actionTh.style.display = 'table-cell';
    title.textContent = 'All Employee Leave Applications';
  } else {
    applyCard.style.display = 'block';
    actionTh.style.display = 'none';
    title.textContent = 'My Leave Applications History';
  }

  try {
    const list = await apiFetch('/api/leaves');
    
    // Update badge and alert banner based on loaded leaves
    const pendingLeavesCount = list.filter(leave => leave.status === 'Pending').length;
    const badge = document.getElementById('leaves-badge');
    if (badge) {
      if (isAdmin && pendingLeavesCount > 0) {
        badge.textContent = pendingLeavesCount;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
    const alertBanner = document.getElementById('leaves-pending-alert');
    const alertText = document.getElementById('leaves-pending-alert-text');
    if (alertBanner && alertText) {
      if (isAdmin && pendingLeavesCount > 0) {
        alertText.textContent = `You have ${pendingLeavesCount} pending leave request${pendingLeavesCount > 1 ? 's' : ''} requiring your review and approval.`;
        alertBanner.style.display = 'flex';
      } else {
        alertBanner.style.display = 'none';
      }
    }
    
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${isAdmin ? 6 : 5}" style="text-align: center; color: var(--text-muted); padding: 3rem;">No leave requests found.</td></tr>`;
      return;
    }

    list.forEach(leave => {
      let statusBadge = '';
      if (leave.status === 'Pending') {
        statusBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: var(--warning);">Pending</span>';
      } else if (leave.status === 'Approved') {
        statusBadge = '<span class="badge badge-in">Approved</span>';
      } else {
        statusBadge = '<span class="badge badge-out">Rejected</span>';
      }

      // Format Date duration
      const duration = `${formatDateString(leave.start_date)} - ${formatDateString(leave.end_date)}`;

      let actionButtons = '';
      if (isAdmin && leave.status === 'Pending') {
        actionButtons = `
          <div class="actions-cell">
            <button class="btn btn-primary btn-sm approve-leave-btn" data-id="${leave.id}" style="background: var(--success); box-shadow: none; font-size: 0.75rem; padding: 0.35rem 0.65rem;">Approve</button>
            <button class="btn btn-danger btn-sm reject-leave-btn" data-id="${leave.id}" style="font-size: 0.75rem; padding: 0.35rem 0.65rem;">Reject</button>
          </div>
        `;
      } else if (isAdmin) {
        actionButtons = `<span style="color:var(--text-muted); font-size: 0.85rem;">Processed</span>`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="employee-profile">
            <div class="avatar" style="background-color: ${leave.color || '#475569'}">${getInitials(leave.name)}</div>
            <div class="employee-meta">
              <span class="employee-name">${leave.name}</span>
              <span class="employee-role">${leave.role} (${leave.employee_id})</span>
            </div>
          </div>
        </td>
        <td style="font-weight: 500;">${leave.leave_type}</td>
        <td style="font-variant-numeric: tabular-nums; font-size: 0.85rem;">${duration}</td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${leave.reason}">
          ${leave.reason}
        </td>
        <td>${statusBadge}</td>
        ${isAdmin ? `<td>${actionButtons}</td>` : ''}
      `;

      // Event bindings
      if (isAdmin && leave.status === 'Pending') {
        tr.querySelector('.approve-leave-btn').addEventListener('click', () => updateLeaveStatus(leave.id, 'Approved'));
        tr.querySelector('.reject-leave-btn').addEventListener('click', () => updateLeaveStatus(leave.id, 'Rejected'));
      }

      tbody.appendChild(tr);
    });

  } catch (err) {
    showToast('Failed to load leave requests: ' + err.message, 'danger');
  }
}

async function handleLeaveSubmit(e) {
  e.preventDefault();
  
  const leaveType = document.getElementById('leave-type-input').value;
  const startDate = document.getElementById('leave-start-date').value;
  const endDate = document.getElementById('leave-end-date').value;
  const reason = document.getElementById('leave-reason-input').value;

  if (startDate > endDate) {
    showToast('Start Date cannot be later than End Date!', 'danger');
    return;
  }

  try {
    const res = await apiFetch('/api/leaves', {
      method: 'POST',
      body: JSON.stringify({ leaveType, startDate, endDate, reason })
    });

    showToast(res.message, 'success');
    document.getElementById('leave-form').reset();
    await renderLeavesTable();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function updateLeaveStatus(leaveId, status) {
  try {
    const res = await apiFetch(`/api/leaves/${leaveId}`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });
    showToast(res.message, 'success');
    await renderLeavesTable();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}


// --- HOLIDAY CALENDAR ---

async function renderHolidaysTable() {
  const tbody = document.getElementById('holidays-tbody');
  const adminCard = document.getElementById('holiday-admin-card');
  const actionTh = document.getElementById('holiday-th-actions');
  
  tbody.innerHTML = '';
  const isAdmin = state.currentUser.isAdmin;

  if (isAdmin) {
    adminCard.style.display = 'block';
    actionTh.style.display = 'table-cell';
  } else {
    adminCard.style.display = 'none';
    actionTh.style.display = 'none';
  }

  try {
    const list = await apiFetch('/api/holidays');
    
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${isAdmin ? 4 : 3}" style="text-align: center; color: var(--text-muted); padding: 3rem;">No holidays in calendar yet.</td></tr>`;
      return;
    }

    list.forEach(h => {
      const isPast = new Date(h.date) < new Date();
      
      const tr = document.createElement('tr');
      tr.style.opacity = isPast ? '0.6' : '1';

      let actionsCell = '';
      if (isAdmin) {
        actionsCell = `
          <td>
            <button class="btn btn-danger btn-sm delete-holiday-btn" data-id="${h.id}">Delete</button>
          </td>
        `;
      }

      tr.innerHTML = `
        <td style="font-variant-numeric: tabular-nums; font-weight: 500;">${formatDateString(h.date)}</td>
        <td style="font-weight: 600;">${h.name}</td>
        <td>
          <span class="badge" style="background: rgba(184, 149, 99, 0.12); color: #8c6a38;">${h.type}</span>
        </td>
        ${actionsCell}
      `;

      if (isAdmin) {
        tr.querySelector('.delete-holiday-btn').addEventListener('click', () => deleteHoliday(h.id));
      }

      tbody.appendChild(tr);
    });

    // Render visual monthly calendar grid
    renderCalendarGrid(list);

  } catch (err) {
    showToast('Failed to load holiday calendar: ' + err.message, 'danger');
  }
}

// Render monthly calendar grid
function renderCalendarGrid(holidays) {
  const container = document.getElementById('calendar-grid-container');
  const monthYearLabel = document.getElementById('calendar-month-year');
  
  if (!container || !monthYearLabel) return;
  
  container.innerHTML = '';
  
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  
  // Set month/year header text
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  monthYearLabel.textContent = `${monthNames[month]} ${year}`;
  
  // Render day headers (Sun to Sat)
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  daysOfWeek.forEach(day => {
    const headerCell = document.createElement('div');
    headerCell.className = 'calendar-header-day';
    headerCell.textContent = day;
    container.appendChild(headerCell);
  });
  
  // Get first day index of month (0 = Sun, 6 = Sat)
  const firstDayIndex = new Date(year, month, 1).getDay();
  
  // Get total days in month
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  // Render empty spacer cells
  for (let i = 0; i < firstDayIndex; i++) {
    const spacer = document.createElement('div');
    spacer.className = 'calendar-day-cell empty';
    container.appendChild(spacer);
  }
  
  // Render day cells
  const todayStr = getTodayISOString();
  
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day-cell';
    cell.textContent = day;
    
    // Check if date is today
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateStr === todayStr) {
      cell.classList.add('today');
    }
    
    // Check if date has a holiday
    const matchedHoliday = holidays.find(h => {
      const hDateStr = h.date.substring(0, 10);
      return hDateStr === dateStr;
    });
    
    if (matchedHoliday) {
      cell.classList.add('has-holiday');
      
      // Create tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'calendar-tooltip';
      tooltip.innerHTML = `<strong>${matchedHoliday.name}</strong><br><span style="opacity:0.85">${matchedHoliday.type}</span>`;
      cell.appendChild(tooltip);
    }
    
    container.appendChild(cell);
  }
}

async function handleHolidaySubmit(e) {
  e.preventDefault();
  const date = document.getElementById('holiday-date-input').value;
  const name = document.getElementById('holiday-name-input').value;
  const type = document.getElementById('holiday-type-input').value;

  try {
    const res = await apiFetch('/api/holidays', {
      method: 'POST',
      body: JSON.stringify({ date, name, type })
    });

    showToast(res.message, 'success');
    document.getElementById('holiday-form').reset();
    await renderHolidaysTable();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function deleteHoliday(id) {
  if (!confirm('Are you sure you want to remove this holiday from the corporate calendar?')) return;
  
  try {
    const res = await apiFetch(`/api/holidays/${id}`, {
      method: 'DELETE'
    });
    showToast(res.message, 'info');
    await renderHolidaysTable();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}


// --- INTERACTIVE VISUAL ANALYTICS (CHART.JS) ---

async function renderAnalyticsTab() {
  try {
    const data = await apiFetch('/api/analytics/charts');
    const statsData = await apiFetch('/api/dashboard/stats');
    const { stats } = statsData;
    
    // Destroy previous chart instances if they exist to prevent glitches
    Object.values(chartInstances).forEach(chart => {
      if (chart) chart.destroy();
    });
    chartInstances = {};

    const isDark = document.body.classList.contains('dark-theme');
    const textThemeColor = isDark ? '#f8fafc' : '#2d271e';
    const gridThemeColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(184, 149, 99, 0.08)';

    // Chart: Attendance Rate
    const isAdmin = state.currentUser.isAdmin;
    const present = stats.present || 0;
    const total = isAdmin ? (stats.total || 0) : (stats.totalDays || 0);
    const absent = Math.max(0, total - present);
    const rate = total > 0 ? Math.round((present / total) * 100) : 0;

    const ratePercentageText = document.getElementById('analytics-attendance-percentage');
    if (ratePercentageText) {
      ratePercentageText.textContent = `${rate}%`;
    }

    const ctxAttendance = document.getElementById('chart-attendance-rate').getContext('2d');
    chartInstances.attendance = new Chart(ctxAttendance, {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Absent'],
        datasets: [{
          data: [present, absent],
          backgroundColor: ['#b89563', isDark ? 'rgba(255,255,255,0.05)' : 'rgba(184, 149, 99, 0.08)'],
          borderWidth: 2,
          borderColor: isDark ? '#1e1e1e' : '#ffffff',
          borderRadius: 6,
          cutout: '70%',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: textThemeColor,
            bodyColor: textThemeColor,
            borderColor: gridThemeColor,
            borderWidth: 1,
            cornerRadius: 8,
            boxPadding: 4
          }
        }
      }
    });

    // Chart 1: Attendance Trends (Smooth Line Chart with Area Fill Gradient)
    const ctxMonthly = document.getElementById('chart-monthly-logs').getContext('2d');
    const fillGradient = ctxMonthly.createLinearGradient(0, 0, 0, 300);
    fillGradient.addColorStop(0, 'rgba(184, 149, 99, 0.25)');
    fillGradient.addColorStop(1, 'rgba(184, 149, 99, 0.00)');

    chartInstances.monthly = new Chart(ctxMonthly, {
      type: 'line',
      data: {
        labels: data.monthlyLogs.map(l => l.label),
        datasets: [{
          label: 'Total Check-ins',
          data: data.monthlyLogs.map(l => l.count),
          borderColor: '#b89563',
          borderWidth: 3,
          backgroundColor: fillGradient,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#b89563',
          pointBorderColor: isDark ? '#1e1e1e' : '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointHoverBackgroundColor: '#aa8552',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: textThemeColor,
            bodyColor: textThemeColor,
            borderColor: gridThemeColor,
            borderWidth: 1,
            cornerRadius: 8,
            boxPadding: 4,
            usePointStyle: true
          }
        },
        scales: {
          x: { 
            grid: { color: gridThemeColor, drawBorder: false },
            ticks: { color: textThemeColor, font: { family: 'Outfit', size: 12 } }
          },
          y: { 
            grid: { color: gridThemeColor, drawBorder: false },
            ticks: { color: textThemeColor, font: { family: 'Outfit', size: 12 }, stepSize: 1 }
          }
        }
      }
    });

    // Chart 2: Location Distribution (Doughnut Chart with rounded corners)
    const ctxStatus = document.getElementById('chart-status-ratio').getContext('2d');
    chartInstances.status = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: data.statusRatio.map(s => s.label),
        datasets: [{
          data: data.statusRatio.map(s => s.count),
          backgroundColor: ['#b89563', '#0284c7', '#d97706'],
          borderWidth: 2,
          borderColor: isDark ? '#1e1e1e' : '#ffffff',
          borderRadius: 6,
          cutout: '70%',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            position: 'right',
            labels: { 
              color: textThemeColor,
              font: { family: 'Outfit', size: 13, weight: '500' },
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            padding: 12,
            backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: textThemeColor,
            bodyColor: textThemeColor,
            borderColor: gridThemeColor,
            borderWidth: 1,
            cornerRadius: 8,
            boxPadding: 4
          }
        }
      }
    });

    // Chart 3: On-Time vs Late Check-ins (Doughnut Chart with rounded corners)
    const ctxOntime = document.getElementById('chart-ontime-ratio').getContext('2d');
    chartInstances.ontime = new Chart(ctxOntime, {
      type: 'doughnut',
      data: {
        labels: data.ontimeRatio.map(o => o.label),
        datasets: [{
          data: data.ontimeRatio.map(o => o.count),
          backgroundColor: ['#2e7d32', '#c62828'],
          borderWidth: 2,
          borderColor: isDark ? '#1e1e1e' : '#ffffff',
          borderRadius: 6,
          cutout: '70%',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { 
            position: 'right',
            labels: { 
              color: textThemeColor,
              font: { family: 'Outfit', size: 13, weight: '500' },
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            padding: 12,
            backgroundColor: isDark ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: textThemeColor,
            bodyColor: textThemeColor,
            borderColor: gridThemeColor,
            borderWidth: 1,
            cornerRadius: 8,
            boxPadding: 4
          }
        }
      }
    });

  } catch (err) {
    showToast('Failed to load chart analytics: ' + err.message, 'danger');
  }
}


// // Greeting banner update based on current time and live weather prediction
function updateGreetingBanner() {
  if (!state.currentUser) return;
  
  const now = new Date();
  const hour = now.getHours();
  
  const banner = document.getElementById('greeting-banner');
  const icon = document.getElementById('greeting-icon');
  const msg = document.getElementById('greeting-message');
  const subtext = document.getElementById('greeting-subtext');
  const weatherDisplay = document.getElementById('weather-display');
  const statusDisplay = document.getElementById('status-display');
  
  if (!banner || !icon || !msg || !subtext) return;
  
  const name = state.currentUser.name;
  
  let greeting = '';
  let sub = '';
  let borderLeftColor = '';
  let weatherWidgetHTML = '';
  
  icon.className = 'greeting-icon';

  // 1. Set Greeting Message & Border Color based on time of day
  if (hour >= 5 && hour < 12) {
    greeting = `Good Morning, ${name}!`;
    sub = 'Have a wonderful and productive day ahead.';
    borderLeftColor = 'var(--warning)';
    icon.classList.add('zpl_morning');
  } else if (hour >= 12 && hour < 17) {
    greeting = `Good Afternoon, ${name}!`;
    sub = 'Keep up the momentum and energy this afternoon!';
    borderLeftColor = 'var(--info)';
    icon.classList.add('zpl_noon');
  } else if (hour >= 17 && hour < 19) {
    greeting = `Good Evening, ${name}!`;
    sub = 'Great work today. Wrapping up the achievements.';
    borderLeftColor = 'var(--primary)';
    icon.classList.add('zpl_evening');
  } else {
    greeting = `Good Night, ${name}!`;
    sub = 'Rest well and recharge for a new day tomorrow.';
    borderLeftColor = 'var(--primary)';
    icon.classList.add('zpl_night');
  }

  // 2. Render Weather Representation (Real Weather if available, fallback otherwise)
  if (state.realWeather) {
    const rw = state.realWeather;
    if (weatherDisplay) {
      weatherDisplay.textContent = `${rw.temp}°C • ${rw.desc}`;
    }
    
    if (rw.isDay) {
      weatherWidgetHTML = `
        <div class="weather-container">
          <svg viewBox="0 0 100 100" class="weather-sun">
            <defs>
              <linearGradient id="sunGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fffdc2" />
                <stop offset="100%" stop-color="#fde047" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="32" fill="url(#sunGradient)" />
          </svg>
      `;
    } else {
      weatherWidgetHTML = `
        <div class="weather-container">
          <svg viewBox="0 0 100 100" class="weather-moon">
            <defs>
              <linearGradient id="moonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#f1f5f9" />
                <stop offset="100%" stop-color="#cbd5e1" />
              </linearGradient>
            </defs>
            <path d="M40 25 A 25 25 0 1 0 70 55 A 20 20 0 1 1 40 25" fill="url(#moonGradient)" />
          </svg>
      `;
    }

    if (rw.isCloudy) {
      if (rw.cloudCount >= 1) weatherWidgetHTML += `<span class="cloud1"><span></span><span></span><span></span><span></span></span>`;
      if (rw.cloudCount >= 2) weatherWidgetHTML += `<span class="cloud2"><span></span><span></span><span></span><span></span></span>`;
      if (rw.cloudCount >= 3) weatherWidgetHTML += `<span class="cloud3"><span></span><span></span><span></span><span></span></span>`;
    }
    weatherWidgetHTML += `</div>`;

  } else {
    // Fallback Mock Weather Generation based on Time
    let weatherText = '29°C • Sunny';
    if (hour >= 5 && hour < 12) {
      weatherText = '27°C • Sunny';
      weatherWidgetHTML = `
        <div class="weather-container">
          <svg viewBox="0 0 100 100" class="weather-sun">
            <defs>
              <linearGradient id="sunGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fffdc2" />
                <stop offset="100%" stop-color="#fde047" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="32" fill="url(#sunGradient)" />
          </svg>
          <span class="cloud1"><span></span><span></span><span></span><span></span></span>
          <span class="cloud2"><span></span><span></span><span></span><span></span></span>
          <span class="cloud3"><span></span><span></span><span></span><span></span></span>
        </div>
      `;
    } else if (hour >= 12 && hour < 17) {
      weatherText = '33°C • Hot & Sunny';
      weatherWidgetHTML = `
        <div class="weather-container">
          <svg viewBox="0 0 100 100" class="weather-sun">
            <defs>
              <linearGradient id="sunGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fffdc2" />
                <stop offset="100%" stop-color="#fde047" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="32" fill="url(#sunGradient)" />
          </svg>
          <span class="cloud1"><span></span><span></span><span></span><span></span></span>
          <span class="cloud2"><span></span><span></span><span></span><span></span></span>
          <span class="cloud3"><span></span><span></span><span></span><span></span></span>
        </div>
      `;
    } else if (hour >= 17 && hour < 19) {
      weatherText = '28°C • Breezy';
      weatherWidgetHTML = `
        <div class="weather-container">
          <svg viewBox="0 0 100 100" class="weather-sun">
            <defs>
              <linearGradient id="sunsetGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fff1f2" />
                <stop offset="100%" stop-color="#fecdd3" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="32" fill="url(#sunsetGradient)" />
          </svg>
          <span class="cloud1"><span></span><span></span><span></span><span></span></span>
          <span class="cloud3"><span></span><span></span><span></span><span></span></span>
        </div>
      `;
    } else {
      weatherText = '23°C • Cool & Clear';
      weatherWidgetHTML = `
        <div class="weather-container">
          <svg viewBox="0 0 100 100" class="weather-moon">
            <defs>
              <linearGradient id="moonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#f1f5f9" />
                <stop offset="100%" stop-color="#cbd5e1" />
              </linearGradient>
            </defs>
            <path d="M40 25 A 25 25 0 1 0 70 55 A 20 20 0 1 1 40 25" fill="url(#moonGradient)" />
          </svg>
          <span class="cloud1"><span></span><span></span><span></span><span></span></span>
          <span class="cloud2"><span></span><span></span><span></span><span></span></span>
          <span class="cloud3"><span></span><span></span><span></span><span></span></span>
        </div>
      `;
    }
    if (weatherDisplay) {
      weatherDisplay.textContent = weatherText;
    }
  }

  msg.textContent = greeting;
  subtext.textContent = sub;
  icon.innerHTML = weatherWidgetHTML;
  banner.style.borderLeftColor = borderLeftColor;

  // 3. Trigger Async Real Weather Fetch
  fetchRealWeather();

  // Set user attendance status
  if (statusDisplay) {
    if (state.todayLogs && Array.isArray(state.todayLogs)) {
      const myLogs = state.todayLogs.filter(log => log.employee_id === state.currentUser.id);
      if (myLogs.length === 0) {
        statusDisplay.innerHTML = `<span style="color: var(--danger); font-weight: 700;">Absent</span>`;
      } else {
        myLogs.sort((a, b) => a.time.localeCompare(b.time));
        const latest = myLogs[myLogs.length - 1];
        if (latest.action === 'Check In') {
          statusDisplay.innerHTML = `<span style="color: var(--success); font-weight: 700;">Checked In (${latest.time.substring(0, 5)})</span>`;
        } else {
          statusDisplay.innerHTML = `<span style="color: var(--text-muted); font-weight: 700;">Checked Out (${latest.time.substring(0, 5)})</span>`;
        }
      }
    } else {
      statusDisplay.textContent = 'Not Checked In';
    }
  }
}

let lastWeatherFetchTime = 0;

// Fetch real-time weather prediction using Open-Meteo API
async function fetchRealWeather() {
  const now = Date.now();
  // Fetch weather at most once every 10 minutes to avoid API spamming
  if (now - lastWeatherFetchTime < 600000) {
    return;
  }
  
  // Default coordinates (Chennai, India as fallback since timezone offset is +05:30)
  let lat = 13.0827;
  let lon = 80.2707;

  // Attempt live Geolocation
  if (navigator.geolocation) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
      });
      lat = position.coords.latitude;
      lon = position.coords.longitude;
    } catch (e) {
      console.warn('Geolocation access failed or timed out. Falling back to default location.', e);
    }
  }

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,is_day,weather_code&timezone=auto`);
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const isDay = data.current.is_day === 1;

    // Map WMO Weather Codes to descriptions and visual flags
    let desc = 'Clear';
    let isCloudy = false;
    let cloudCount = 0;

    if (code === 0) {
      desc = isDay ? 'Clear Sky' : 'Clear Night';
    } else if (code === 1) {
      desc = 'Mainly Clear';
      isCloudy = true;
      cloudCount = 1;
    } else if (code === 2) {
      desc = 'Partly Cloudy';
      isCloudy = true;
      cloudCount = 2;
    } else if (code === 3) {
      desc = 'Overcast';
      isCloudy = true;
      cloudCount = 3;
    } else if (code === 45 || code === 48) {
      desc = 'Foggy';
      isCloudy = true;
      cloudCount = 2;
    } else if (code >= 51 && code <= 65) {
      desc = 'Rainy';
      isCloudy = true;
      cloudCount = 3;
    } else if (code >= 71 && code <= 77) {
      desc = 'Snowy';
      isCloudy = true;
      cloudCount = 3;
    } else if (code >= 80 && code <= 82) {
      desc = 'Rain Showers';
      isCloudy = true;
      cloudCount = 3;
    } else if (code >= 95 && code <= 99) {
      desc = 'Thunderstorm';
      isCloudy = true;
      cloudCount = 3;
    }

    // Save fetched weather state to trigger UI update
    state.realWeather = { temp, desc, isDay, isCloudy, cloudCount };
    lastWeatherFetchTime = now;

    // Refresh UI to display real weather representation immediately
    updateGreetingBanner();
  } catch (err) {
    console.error('Failed to retrieve live weather prediction:', err);
    // Mark as failed but set timestamp so we don't retry immediately
    lastWeatherFetchTime = now;
  }
}

// Live ticking clock
function startLiveClock() {
  const clockTime = document.getElementById('clock-time');
  const clockDate = document.getElementById('clock-date');
  const clockDay = document.getElementById('clock-day');

  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    if (clockTime) clockTime.textContent = `${h}:${m}:${s}`;
    if (clockDate) clockDate.textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    if (clockDay) clockDay.textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
    updateGreetingBanner();
    updateLiveWorkDuration();
  }

  tick();
  setInterval(tick, 1000);
}

// Format time string from HH:MM:SS to HH:MM AM/PM
function formatTimeString(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length < 2) return timeStr;
  let hrs = parseInt(parts[0]);
  const mins = parts[1];
  const amamp = hrs >= 12 ? 'PM' : 'AM';
  hrs = hrs % 12;
  hrs = hrs ? hrs : 12; // the hour '0' should be '12'
  return `${String(hrs).padStart(2, '0')}:${mins} ${amamp}`;
}

// Calculate and update the live dashboard working duration timer in template boxes
function updateLiveWorkDuration() {
  const hhEl = document.getElementById('hh');
  const mmEl = document.getElementById('mm');
  const ssEl = document.getElementById('ss');
  if (!hhEl || !mmEl || !ssEl) return;

  if (state.userCheckInTime) {
    let endTime = new Date();
    if (state.userCheckOutTime) {
      endTime = state.userCheckOutTime;
    }
    const durationMs = endTime - state.userCheckInTime;
    if (durationMs > 0) {
      const secs = Math.floor(durationMs / 1000) % 60;
      const mins = Math.floor(durationMs / 60000) % 60;
      const hours = Math.floor(durationMs / 3600000);
      
      hhEl.textContent = String(hours).padStart(2, '0');
      mmEl.textContent = String(mins).padStart(2, '0');
      ssEl.textContent = String(secs).padStart(2, '0');
    } else {
      hhEl.textContent = '00';
      mmEl.textContent = '00';
      ssEl.textContent = '00';
    }
  } else {
    hhEl.textContent = '00';
    mmEl.textContent = '00';
  }
}

// Quick Attendance Marking for Dashboard
async function handleQuickMarkAttendance(action) {
  if (!state.currentUser) return;
  
  const remarksInput = document.getElementById('quick-remarks');
  const remarks = remarksInput ? remarksInput.value.trim() : '';
  const activePill = document.querySelector('#quick-status-pills .status-pill.active');
  const status = activePill ? activePill.getAttribute('data-val') : 'Office';

  setQuickButtonLoading(true);

  if (status === 'Office' && action === 'Check In' && navigator.geolocation) {
    showToast('Retrieving GPS location for range verification...', 'info');
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        await submitQuickMarkRequest(action, status, remarks, latitude, longitude);
      },
      async (err) => {
        console.warn('Geolocation failed:', err);
        showToast('Location permission denied or timeout. Submitting check-in without range verification...', 'warning');
        await submitQuickMarkRequest(action, status, remarks, null, null);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  } else {
    await submitQuickMarkRequest(action, status, remarks, null, null);
  }
}

async function submitQuickMarkRequest(action, status, remarks, latitude, longitude) {
  try {
    const res = await apiFetch('/api/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: state.currentUser.id,
        action,
        status,
        remarks,
        latitude,
        longitude
      })
    });

    const remarksInput = document.getElementById('quick-remarks');
    if (remarksInput) remarksInput.value = '';
    
    if (res.log && res.log.distance_meters !== null) {
      const dist = res.log.distance_meters;
      if (dist <= 200) {
        showToast(`Successfully marked ${action}! verified in office range (${dist}m away).`, 'success');
      } else {
        showToast(`Marked ${action}! Warning: Detected outside office boundaries (${dist}m).`, 'warning');
      }
    } else {
      showToast(res.message, 'success');
    }
    
    // Refresh stats and layout
    await updateDashboardStats();
  } catch (err) {
    showToast(err.message, 'danger');
  } finally {
    setQuickButtonLoading(false);
  }
}

function setQuickButtonLoading(isLoading) {
  const btn = document.getElementById('btn-quick-attendance');
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.textContent = 'Processing...';
  } else {
    if (btn.classList.contains('check-in-btn')) {
      btn.textContent = 'Check-in';
    } else if (btn.classList.contains('check-out-btn')) {
      btn.textContent = 'Check-out';
    } else {
      btn.textContent = 'Checked Out';
    }
  }
}

// Configure UI Sidebar layout according to user permissions
function adaptPortalInterface() {
  const user = state.currentUser;
  if (!user) return;

  const sidebarName = document.getElementById('sidebar-user-name');
  const sidebarRole = document.getElementById('sidebar-user-role');
  const sidebarAvatar = document.getElementById('sidebar-user-avatar');
  const itemEmployees = document.getElementById('nav-item-employees');
  const reportSearchWrapper = document.getElementById('reports-search-wrapper');
  
  const textDashboard = document.getElementById('nav-text-dashboard');
  const textAttendance = document.getElementById('nav-text-attendance');
  const textReports = document.getElementById('nav-text-reports');

  if (user.isAdmin) {
    sidebarName.textContent = user.name || 'Administrator';
    sidebarRole.textContent = user.role || 'HR Portal';
    sidebarAvatar.textContent = getInitials(user.name || 'Admin User');
    sidebarAvatar.style.backgroundColor = user.color || '#6366f1';
    
    itemEmployees.style.display = '';
    textDashboard.textContent = 'Dashboard';
    textAttendance.textContent = 'Mark Attendance';
    textReports.textContent = 'Reports & History';
    
    if (reportSearchWrapper) reportSearchWrapper.style.display = 'block';
  } else {
    sidebarName.textContent = user.name;
    sidebarRole.textContent = `${user.role} (${user.id})`;
    sidebarAvatar.textContent = getInitials(user.name);
    sidebarAvatar.style.backgroundColor = user.color;
    
    itemEmployees.style.display = 'none';
    textDashboard.textContent = 'My Stats';
    textAttendance.textContent = 'Check In/Out';
    textReports.textContent = 'My History';

    if (reportSearchWrapper) reportSearchWrapper.style.display = 'none';
  }

  updateLeaveBadge();
  document.querySelector('.nav-link[data-tab="dashboard"]').click();
}

// Login Handler
async function handleLoginSubmit(e) {
  e.preventDefault();
  
  const isEmployeeTab = document.getElementById('login-tab-employee').classList.contains('active');
  let payload = {};
  
  if (isEmployeeTab) {
    const empId = document.getElementById('login-employee-id').value.trim().toUpperCase();
    const password = document.getElementById('login-employee-password').value;
    
    if (!empId || !password) {
      showToast('Please enter your Employee ID and Password!', 'danger');
      return;
    }
    
    payload = { employeeId: empId, password, isAdminLogin: false };
  } else {
    const adminId = document.getElementById('login-admin-id').value.trim().toUpperCase();
    const password = document.getElementById('login-admin-password').value;
    
    if (!adminId || !password) {
      showToast('Please enter your Admin Email/ID and Password!', 'danger');
      return;
    }
    
    payload = { employeeId: adminId, password, isAdminLogin: true };
  }

  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    state.token = data.token;
    state.currentUser = data.user;
    safeStorage.setItem('attendance_jwt', state.token);
    safeStorage.setItem('attendance_user', JSON.stringify(state.currentUser));
    
    showToast(`Welcome back, ${data.user.name}!`, 'success');
    
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    
    document.getElementById('login-employee-id').value = '';
    document.getElementById('login-employee-password').value = '';
    document.getElementById('login-admin-id').value = '';
    document.getElementById('login-admin-password').value = '';
    
    adaptPortalInterface();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Logout Handler
function handleLogout() {
  const modal = document.getElementById('logout-confirm-modal');
  if (modal) {
    modal.classList.add('active');
  }
}

// Actual Logout execution (after user confirms in custom modal)
function executeActualLogout() {
  state.token = null;
  state.currentUser = null;
  state.employees = [];
  state.todayLogs = [];
  
  safeStorage.removeItem('attendance_jwt');
  safeStorage.removeItem('attendance_user');
  
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  
  showToast('Signed out successfully.', 'info');
}

// DOM Init
document.addEventListener('DOMContentLoaded', () => {
  // ---- Theme switch initialization ----
  const isDark = safeStorage.getItem('dark_mode') === 'true';
  if (isDark) {
    document.body.classList.add('dark-theme');
  }

  const handleThemeToggle = () => {
    const currentTheme = document.body.classList.toggle('dark-theme');
    safeStorage.setItem('dark_mode', currentTheme);
    showToast(`Switched to ${currentTheme ? 'Dark Mode' : 'Light Mode'}.`, 'info');
    
    // Redraw charts to update text colors in analytics if visible
    if (state.activeTab === 'analytics') {
      renderAnalyticsTab();
    }
  };

  const btnToggleDark = document.getElementById('btn-toggle-dark');
  const btnToggleDarkRight = document.getElementById('btn-toggle-dark-right');
  
  if (btnToggleDark) {
    btnToggleDark.addEventListener('click', handleThemeToggle);
  }
  if (btnToggleDarkRight) {
    btnToggleDarkRight.addEventListener('click', handleThemeToggle);
  }
  const btnToggleDarkMobile = document.getElementById('btn-toggle-dark-mobile');
  if (btnToggleDarkMobile) {
    btnToggleDarkMobile.addEventListener('click', handleThemeToggle);
  }

  // ---- Login Tabs switching ----
  const loginTabEmp = document.getElementById('login-tab-employee');
  const loginTabAdmin = document.getElementById('login-tab-admin');
  const groupEmp = document.getElementById('login-group-employee');
  const groupAdmin = document.getElementById('login-group-admin');

  loginTabEmp.addEventListener('click', () => {
    loginTabEmp.classList.add('active');
    loginTabAdmin.classList.remove('active');
    groupEmp.style.display = 'block';
    groupAdmin.style.display = 'none';
  });

  loginTabAdmin.addEventListener('click', () => {
    loginTabAdmin.classList.add('active');
    loginTabEmp.classList.remove('active');
    groupEmp.style.display = 'none';
    groupAdmin.style.display = 'block';
  });

  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);
  
  const btnLogoutMobile = document.getElementById('btn-logout-mobile');
  if (btnLogoutMobile) btnLogoutMobile.addEventListener('click', handleLogout);

  // ---- Sidebar Navigation ----
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', async (e) => {
      
      const tabId = link.getAttribute('data-tab');
      if (!tabId) return; // Skip links without tab destinations (like logout)
      
      e.preventDefault();
      state.activeTab = tabId;

      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      const tabs = document.querySelectorAll('.tab-content');
      tabs.forEach(t => t.classList.remove('active'));
      document.getElementById(`${tabId}-tab`).classList.add('active');

      // Set titles
      const userRole = (state.currentUser && state.currentUser.isAdmin) ? 'admin' : 'employee';
      document.getElementById('header-title').textContent = HEADERS[tabId][userRole] ? HEADERS[tabId][userRole].title : HEADERS[tabId].title;
      document.getElementById('header-subtitle').textContent = HEADERS[tabId][userRole] ? HEADERS[tabId][userRole].subtitle : HEADERS[tabId].subtitle;

      // Reload appropriate tab content
      if (tabId === 'dashboard') {
        await updateDashboardStats();
      } else if (tabId === 'attendance') {
        await renderAttendanceSelector();
      } else if (tabId === 'employees') {
        await renderEmployeesTable();
      } else if (tabId === 'reports') {
        await renderReportsTable();
      } else if (tabId === 'leaves') {
        await renderLeavesTable();
      } else if (tabId === 'holidays') {
        await renderHolidaysTable();
      } else if (tabId === 'analytics') {
        await renderAnalyticsTab();
      }
    });
  });

  // ---- Mobile Drawer Navigation Event Listeners ----
  const btnMenuToggle = document.getElementById('btn-menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  if (btnMenuToggle && sidebar && sidebarOverlay) {
    const toggleMenu = () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('active');
    };

    const closeMenu = () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
    };

    btnMenuToggle.addEventListener('click', toggleMenu);
    sidebarOverlay.addEventListener('click', closeMenu);

    // Close menu when any nav-link is clicked on mobile
    const navLinksList = document.querySelectorAll('.sidebar .nav-link');
    navLinksList.forEach(link => {
      link.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) {
          closeMenu();
        }
      });
    });
  }

  // ---- Custom Logout Modal Event Listeners ----
  const btnLogoutConfirm = document.getElementById('btn-logout-confirm');
  const btnLogoutCancel = document.getElementById('btn-logout-cancel');
  const logoutModalBackdrop = document.getElementById('logout-modal-backdrop');

  const closeLogoutModal = () => {
    const modal = document.getElementById('logout-confirm-modal');
    if (modal) modal.classList.remove('active');
  };

  if (btnLogoutConfirm) {
    btnLogoutConfirm.addEventListener('click', () => {
      closeLogoutModal();
      executeActualLogout();
    });
  }

  if (btnLogoutCancel) {
    btnLogoutCancel.addEventListener('click', closeLogoutModal);
  }

  if (logoutModalBackdrop) {
    logoutModalBackdrop.addEventListener('click', closeLogoutModal);
  }

  document.getElementById('btn-view-logs').addEventListener('click', () => {
    document.querySelector('.nav-link[data-tab="reports"]').click();
  });

  // Location Pills
  const statusPills = document.querySelectorAll('#status-pill-group .status-pill');
  statusPills.forEach(pill => {
    pill.addEventListener('click', () => {
      statusPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  document.getElementById('attendance-search').addEventListener('input', (e) => {
    renderAttendanceSelector(e.target.value);
  });

  document.getElementById('btn-check-in').addEventListener('click', () => handleMarkAttendance('Check In'));
  document.getElementById('btn-check-out').addEventListener('click', () => handleMarkAttendance('Check Out'));

  // ---- Quick Attendance Card Event Listeners (Dashboard) ----
  const btnQuickAttendance = document.getElementById('btn-quick-attendance');
  if (btnQuickAttendance) {
    btnQuickAttendance.addEventListener('click', () => {
      if (btnQuickAttendance.classList.contains('check-in-btn')) {
        handleQuickMarkAttendance('Check In');
      } else if (btnQuickAttendance.classList.contains('check-out-btn')) {
        handleQuickMarkAttendance('Check Out');
      }
    });
  }

  const quickPills = document.querySelectorAll('#quick-status-pills .status-pill');
  quickPills.forEach(pill => {
    pill.addEventListener('click', () => {
      quickPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  document.getElementById('employee-search').addEventListener('input', (e) => {
    renderEmployeesTable(e.target.value);
  });

  document.getElementById('btn-add-employee').addEventListener('click', () => openEmployeeModal());
  document.getElementById('btn-close-modal').addEventListener('click', closeEmployeeModal);
  document.getElementById('btn-cancel-modal').addEventListener('click', closeEmployeeModal);
  document.getElementById('employee-form').addEventListener('submit', handleEmployeeFormSubmit);

  document.getElementById('employee-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('employee-modal')) {
      closeEmployeeModal();
    }
  });

  document.getElementById('report-search').addEventListener('input', renderReportsTable);
  document.getElementById('filter-status').addEventListener('change', renderReportsTable);
  document.getElementById('filter-start-date').addEventListener('change', renderReportsTable);
  document.getElementById('filter-end-date').addEventListener('change', renderReportsTable);

  document.getElementById('btn-clear-filters').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('report-search').value = '';
    document.getElementById('filter-status').value = 'All';
    document.getElementById('filter-start-date').value = '';
    document.getElementById('filter-end-date').value = '';
    
    renderReportsTable();
    showToast('Filters cleared successfully.', 'info');
  });

  document.getElementById('btn-export-csv').addEventListener('click', exportToCSV);

  // Leave Form submit
  document.getElementById('leave-form').addEventListener('submit', handleLeaveSubmit);

  // Holiday Form submit
  document.getElementById('holiday-form').addEventListener('submit', handleHolidaySubmit);

  // Calendar month buttons navigation
  document.getElementById('btn-prev-month').addEventListener('click', async () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    await renderHolidaysTable();
  });

  document.getElementById('btn-next-month').addEventListener('click', async () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    await renderHolidaysTable();
  });

  // Clock init
  startLiveClock();

  // Session checks
  if (state.currentUser && state.token) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'flex';
    adaptPortalInterface();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
  }
});
