// Global state
let currentStatus = 'OUT';
let currentLocation = null;
let currentEmployee = null;
let userEmail = '';
let config = {
    middlewareUrl: 'https://octagon-ess-middleware-rl71.onrender.com',
    employeeId: '',
    employmentType: '',
    siteLat: null,
    siteLng: null,
    siteRadius: 100,
    shiftLocationName: '',
    todaysShift: null
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    displayDate();
    getLocation();
    
    // Check if already logged in
    const savedConfig = localStorage.getItem('erpnext_config');
    const savedEmployee = localStorage.getItem('currentEmployee');
    const savedEmail = localStorage.getItem('userEmail');
    
    if (savedConfig && savedEmployee && savedEmail) {
        config = JSON.parse(savedConfig);
        currentEmployee = JSON.parse(savedEmployee);
        userEmail = savedEmail;
        showAppSection();
        initializeDashboard();
    }
});

function displayDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dateDisplay').textContent = now.toLocaleDateString('en-US', options);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Get device location - IMPROVED VERSION
function getLocation() {
    const locationEl = document.getElementById('locationDisplay');
    
    if (!navigator.geolocation) {
        if (locationEl) locationEl.textContent = '❌ Geolocation not supported';
        return;
    }
    
    if (locationEl) locationEl.textContent = '📍 Requesting location...';
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            currentLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            };
            if (locationEl) {
                locationEl.innerHTML = `📍 Lat: ${currentLocation.latitude.toFixed(6)}, Lng: ${currentLocation.longitude.toFixed(6)}`;
            }
        },
        (error) => {
            console.error('Geolocation error:', error);
            if (locationEl) {
                locationEl.innerHTML = `
                    ❌ Location unavailable 
                    <button onclick="getLocation()" style="padding: 4px 8px; margin-left: 8px; font-size: 12px; width: auto; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
                `;
            }
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}

// Handle login with email and password
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showStatus('Please enter email and password', 'error');
        return;
    }
    
    // Find the login button - handle both old and new HTML structures
    const loginBtn = document.querySelector('#loginScreen button') || 
                     document.querySelector('#loginSection button');
    
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Signing in...';
    }
    
    try {
        // Step 1: Authenticate via middleware
        const loginResponse = await fetch(`${config.middlewareUrl}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const loginResult = await loginResponse.json();
        
        if (!loginResult.success) {
            throw new Error(loginResult.error || 'Invalid credentials');
        }
        
        // Step 2: Fetch employee record
        const empResponse = await fetch(`${config.middlewareUrl}/api/employee/${encodeURIComponent(email)}`);
        const empResult = await empResponse.json();
        
        if (!empResult.success) {
            throw new Error(empResult.error || 'Employee record not found');
        }
        
        currentEmployee = empResult.employee;
        config.employeeId = currentEmployee.id;
        config.employmentType = currentEmployee.employment_type || 'Full-time';
        userEmail = email;
        
        // Update drawer info with employee name
        updateDrawerInfo();
        
        // Store for persistence
        localStorage.setItem('erpnext_config', JSON.stringify(config));
        localStorage.setItem('currentEmployee', JSON.stringify(currentEmployee));
        localStorage.setItem('userEmail', userEmail);
        
        // Step 3: Fetch today's shift assignment
        await fetchTodaysShiftAssignment();
        
        // Update UI with employee info
        const employeeName = currentEmployee.name || currentEmployee.employee_name || 'Employee';
        const employeeInfoEl = document.getElementById('employeeInfo');
        if (employeeInfoEl) {
            employeeInfoEl.innerHTML = `
                👤 ${employeeName}<br>
                🏢 ${currentEmployee.department || 'N/A'}<br>
                💼 ${currentEmployee.designation || 'N/A'}<br>
                <span class="badge ${config.employmentType === 'Daily Wage' ? 'badge-field' : 'badge-office'}">
                    ${config.employmentType}
                </span>
            `;
        }
        
        showAppSection();
        initializeDashboard();
        showStatus(`Welcome, ${employeeName}!`, 'success');
        
    } catch (error) {
        console.error('Login error:', error);
        showStatus(`Login error: ${error.message}`, 'error');
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Sign In';
        }
    }
}

// Fetch today's shift assignment from middleware
async function fetchTodaysShiftAssignment() {
    try {
        const response = await fetch(`${config.middlewareUrl}/api/shift-assignment/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.assignment && result.assignment.location) {
            const loc = result.assignment.location;
            config.siteLat = loc.latitude;
            config.siteLng = loc.longitude;
            config.siteRadius = loc.radius || 100;
            config.shiftLocationName = loc.name;
            config.todaysShift = result.assignment.shift_type;
            
            document.getElementById('worksiteDisplay').innerHTML = `
                ✅ Assigned: ${loc.name}<br>
                📏 Radius: ${config.siteRadius}m<br>
                🕒 Shift: ${result.assignment.shift_type}
            `;
            document.getElementById('checkBtn').disabled = false;
            
            // Check current check-in status
            await checkCurrentStatus();
        } else {
            document.getElementById('worksiteDisplay').innerHTML = '⚠️ No shift assigned for today. Contact scheduler.';
            document.getElementById('checkBtn').disabled = true;
        }
    } catch (error) {
        console.error('Error fetching shift:', error);
        document.getElementById('worksiteDisplay').textContent = '❌ Error loading assignment';
        document.getElementById('checkBtn').disabled = true;
    }
}

// Show main app section - CORRECTED VERSION
function showAppSection() {
    const loginScreen = document.getElementById('loginScreen');
    const dashboardScreen = document.getElementById('dashboardScreen');
    
    if (loginScreen) loginScreen.classList.remove('active');
    if (dashboardScreen) dashboardScreen.classList.add('active');
    
    document.getElementById('screenTitle').textContent = 'Dashboard';
    
    // Update drawer info
    updateDrawerInfo();
    
    // Show check-in button ONLY for Daily Wage employees
    const checkBtn = document.getElementById('checkBtn');
    const worksiteEl = document.getElementById('worksiteDisplay');
    
    if (config.employmentType === 'Daily Wage') {
        if (checkBtn) checkBtn.style.display = 'block';
    } else {
        if (checkBtn) checkBtn.style.display = 'none';
        if (worksiteEl) worksiteEl.textContent = '🏢 Office-based employee';
    }
}

function initializeDashboard() {
    if (config.employmentType === 'Daily Wage') {
        document.getElementById('fieldWorkerDashboard').classList.remove('hidden');
        document.getElementById('officeStaffDashboard').classList.add('hidden');
        loadFieldWorkerDashboard();
    } else {
        document.getElementById('fieldWorkerDashboard').classList.add('hidden');
        document.getElementById('officeStaffDashboard').classList.remove('hidden');
        loadOfficeStaffDashboard();
    }
}

async function loadFieldWorkerDashboard() {
    try {
        const response = await fetch(`${config.middlewareUrl}/api/today-checkins/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.checkins) {
            const hours = calculateHoursFromCheckins(result.checkins);
            document.getElementById('hoursDisplay').innerHTML = `
                <div class="hours-row"><span>Regular Hours:</span> <span>${hours.regular.toFixed(2)} hrs</span></div>
                <div class="hours-row"><span>Overtime:</span> <span>${hours.overtime.toFixed(2)} hrs</span></div>
                <div class="hours-total"><span>Total:</span> <span>${hours.total.toFixed(2)} hrs</span></div>
            `;
        } else {
            document.getElementById('hoursDisplay').innerHTML = '<p>No check-ins today</p>';
        }
        
        document.getElementById('weekHoursDisplay').innerHTML = `
            <div class="hours-row"><span>This Week:</span> <span>-- hrs</span></div>
            <p style="font-size: 12px; color: #666; margin-top: 8px;">* Week summary coming soon</p>
        `;
    } catch (error) {
        console.error('Error loading dashboard:', error);
        document.getElementById('hoursDisplay').innerHTML = '<p>Error loading hours</p>';
    }
}

function calculateHoursFromCheckins(checkins) {
    let totalMinutes = 0;
    const standardShiftMinutes = 480; // 8 hours
    
    for (let i = 0; i < checkins.length; i += 2) {
        if (i + 1 < checkins.length) {
            const inTime = new Date(checkins[i].time);
            const outTime = new Date(checkins[i+1].time);
            const diffMinutes = (outTime - inTime) / (1000 * 60);
            totalMinutes += diffMinutes;
        }
    }
    
    const regularMinutes = Math.min(totalMinutes, standardShiftMinutes);
    const overtimeMinutes = Math.max(0, totalMinutes - standardShiftMinutes);
    
    return {
        regular: regularMinutes / 60,
        overtime: overtimeMinutes / 60,
        total: totalMinutes / 60
    };
}

async function loadOfficeStaffDashboard() {
    const today = new Date();
    const month = today.toLocaleDateString('en-US', { month: 'long' });
    const year = today.getFullYear();
    
    document.getElementById('attendanceDisplay').innerHTML = `
        <p><strong>${month} ${year}</strong></p>
        <div class="hours-row"><span>Present Days:</span> <span>--</span></div>
        <div class="hours-row"><span>Absent Days:</span> <span>--</span></div>
        <p style="font-size: 12px; color: #666; margin-top: 8px;">* Sync in progress</p>
    `;
    
    document.getElementById('leaveDisplay').innerHTML = `
        <div class="hours-row"><span>Annual Leave:</span> <span>-- / 14 days</span></div>
        <div class="hours-row"><span>Sick Leave:</span> <span>-- / 14 days</span></div>
    `;
}

async function checkCurrentStatus() {
    try {
        const response = await fetch(`${config.middlewareUrl}/api/today-checkins/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.checkins && result.checkins.length > 0) {
            const lastLog = result.checkins[result.checkins.length - 1];
            currentStatus = lastLog.log_type;
            updateButtonState();
        }
    } catch (error) {
        console.error('Error checking status:', error);
    }
}

function updateButtonState() {
    const btn = document.getElementById('checkBtn');
    if (currentStatus === 'IN') {
        btn.textContent = 'CHECK OUT';
        btn.className = 'check-btn check-out';
    } else {
        btn.textContent = 'CHECK IN';
        btn.className = 'check-btn check-in';
    }
}

// Handle check in/out
document.getElementById('checkBtn').addEventListener('click', async () => {
    if (!currentLocation) {
        showStatus('Location not available. Please enable GPS.', 'error');
        getLocation();
        return;
    }
    
    // Geofencing validation
    if (config.siteLat && config.siteLng) {
        const distance = calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            config.siteLat,
            config.siteLng
        );
        
        if (distance > config.siteRadius) {
            showStatus(
                `📍 You are ${Math.round(distance)}m from ${config.shiftLocationName || 'worksite'}. Allowed: ${config.siteRadius}m. Check-in denied.`,
                'error'
            );
            return;
        }
        
        console.log(`✅ Distance to ${config.shiftLocationName}: ${Math.round(distance)}m`);
    }
    
    const btn = document.getElementById('checkBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    
    const logType = currentStatus === 'IN' ? 'OUT' : 'IN';
    
    try {
        const now = new Date();
        const timestamp = now.getFullYear() + '-' + 
            String(now.getMonth() + 1).padStart(2, '0') + '-' + 
            String(now.getDate()).padStart(2, '0') + ' ' + 
            String(now.getHours()).padStart(2, '0') + ':' + 
            String(now.getMinutes()).padStart(2, '0') + ':' + 
            String(now.getSeconds()).padStart(2, '0');
        
        const response = await fetch(`${config.middlewareUrl}/api/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: config.employeeId,
                logType: logType,
                timestamp: timestamp
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            currentStatus = logType;
            updateButtonState();
            showStatus(`✅ Successfully checked ${logType.toLowerCase()} at ${now.toLocaleTimeString()}`, 'success');
            
            // Refresh dashboard
            if (config.employmentType === 'Daily Wage') {
                setTimeout(loadFieldWorkerDashboard, 1000);
            }
        } else {
            throw new Error(result.error || 'Check-in failed');
        }
    } catch (error) {
        showStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
    }
});

// Placeholder functions
function applyLeave() {
    showStatus('📝 Leave application coming soon!', 'info');
}

function viewPayslips() {
    showStatus('💰 Payslip viewing coming soon!', 'info');
}

function viewSchedule() {
    showStatus('📋 Schedule viewing coming soon!', 'info');
}

function logout() {
    closeDrawer();
    localStorage.removeItem('erpnext_config');
    localStorage.removeItem('currentEmployee');
    localStorage.removeItem('userEmail');
    
    currentEmployee = null;
    userEmail = '';
    config.employeeId = '';
    
    // Hide all screens, show login
    const screens = ['dashboardScreen', 'leaveScreen', 'payslipsScreen', 'scheduleScreen', 'profileScreen'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('screenTitle').textContent = 'Sign In';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    
    showStatus('Signed out successfully', 'info');
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    if (!statusDiv) return;
    
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}

// ============================================
// NAVIGATION FUNCTIONS
// ============================================

function openDrawer() {
    const drawer = document.getElementById('sideDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (drawer) drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
}

function closeDrawer() {
    const drawer = document.getElementById('sideDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (drawer) drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
}

function navigateTo(screen) {
    closeDrawer();
    
    // Hide all screens
    const screens = ['loginScreen', 'dashboardScreen', 'leaveScreen', 'payslipsScreen', 'scheduleScreen', 'profileScreen'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    
    // Show selected screen
    const activeScreen = document.getElementById(screen + 'Screen');
    if (activeScreen) activeScreen.classList.add('active');
    
    // Update header title
    const titles = {
        'dashboard': 'Dashboard',
        'leave': 'Leave',
        'payslips': 'Payslips',
        'schedule': 'Schedule',
        'profile': 'Profile'
    };
    const titleEl = document.getElementById('screenTitle');
    if (titleEl) titleEl.textContent = titles[screen] || 'Octagon ESS';
    
    // Load screen-specific data
    if (screen === 'leave') {
        if (typeof loadLeaveScreen === 'function') loadLeaveScreen();
    } else if (screen === 'payslips') {
        if (typeof loadPayslipsScreen === 'function') loadPayslipsScreen();
    } else if (screen === 'schedule') {
        if (typeof loadScheduleScreen === 'function') loadScheduleScreen();
    } else if (screen === 'profile') {
        if (typeof loadProfileScreen === 'function') loadProfileScreen();
    }
}

function updateDrawerInfo() {
    const employeeName = currentEmployee?.name || currentEmployee?.employee_name || 'Employee';
    const nameEl = document.getElementById('drawerEmployeeName');
    const deptEl = document.getElementById('drawerEmployeeDept');
    if (nameEl) nameEl.textContent = employeeName;
    if (deptEl) deptEl.textContent = currentEmployee?.department || 'N/A';
}
// ============================================
// LEAVE FUNCTIONS
// ============================================

async function loadLeaveScreen() {
    if (!config.employeeId) return;
    await loadLeaveBalance();
    await loadLeaveRequests();
}

async function loadLeaveBalance() {
    try {
        // Fetch leave balance from ERPNext via middleware
        const response = await fetch(`${config.middlewareUrl}/api/leave-balance/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.balances) {
            let html = '';
            result.balances.forEach(b => {
                html += `
                    <div class="leave-type">
                        <div class="count">${b.leaves_allocated - b.leaves_taken}</div>
                        <div class="label">${b.leave_type}</div>
                    </div>
                `;
            });
            document.getElementById('leaveBalanceSummary').innerHTML = html || '<p>No leave allocations found</p>';
        } else {
            // Fallback - show default
            document.getElementById('leaveBalanceSummary').innerHTML = `
                <div class="leave-type"><div class="count">--</div><div class="label">Annual</div></div>
                <div class="leave-type"><div class="count">--</div><div class="label">Sick</div></div>
                <div class="leave-type"><div class="count">--</div><div class="label">Casual</div></div>
            `;
        }
    } catch (error) {
        console.error('Error loading leave balance:', error);
        document.getElementById('leaveBalanceSummary').innerHTML = '<p>Error loading balance</p>';
    }
}

async function loadLeaveRequests() {
    try {
        const response = await fetch(`${config.middlewareUrl}/api/leave-requests/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.requests && result.requests.length > 0) {
            let html = '';
            result.requests.slice(0, 5).forEach(req => {
                const statusClass = req.status === 'Approved' ? 'status-approved' : 
                                   (req.status === 'Rejected' ? 'status-rejected' : 'status-pending');
                html += `
                    <div class="leave-request-item">
                        <div style="display: flex; justify-content: space-between;">
                            <strong>${req.leave_type}</strong>
                            <span class="leave-status ${statusClass}">${req.status}</span>
                        </div>
                        <div style="font-size: 14px; color: #666; margin-top: 4px;">
                            ${req.from_date} to ${req.to_date}
                        </div>
                    </div>
                `;
            });
            document.getElementById('leaveRequestsList').innerHTML = html;
        } else {
            document.getElementById('leaveRequestsList').innerHTML = '<p style="color: #666;">No leave requests found</p>';
        }
    } catch (error) {
        console.error('Error loading leave requests:', error);
        document.getElementById('leaveRequestsList').innerHTML = '<p>Error loading requests</p>';
    }
}

async function submitLeaveApplication() {
    const leaveType = document.getElementById('leaveType').value;
    const fromDate = document.getElementById('leaveFromDate').value;
    const toDate = document.getElementById('leaveToDate').value;
    const halfDay = document.getElementById('leaveHalfDay').value;
    const reason = document.getElementById('leaveReason').value;
    
    if (!leaveType || !fromDate || !toDate || !reason) {
        showLeaveStatus('Please fill all fields', 'error');
        return;
    }
    
    const submitBtn = document.querySelector('#leaveScreen button');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/leave-application`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: config.employeeId,
                leaveType: leaveType,
                fromDate: fromDate,
                toDate: toDate,
                halfDay: halfDay !== '0',
                halfDayDate: halfDay !== '0' ? fromDate : null,
                reason: reason
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showLeaveStatus('✅ Leave request submitted successfully!', 'success');
            // Clear form
            document.getElementById('leaveType').value = '';
            document.getElementById('leaveFromDate').value = '';
            document.getElementById('leaveToDate').value = '';
            document.getElementById('leaveHalfDay').value = '0';
            document.getElementById('leaveReason').value = '';
            // Refresh list
            await loadLeaveRequests();
        } else {
            throw new Error(result.error || 'Failed to submit');
        }
    } catch (error) {
        showLeaveStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Leave Request';
    }
}

function showLeaveStatus(message, type) {
    const statusDiv = document.getElementById('leaveStatusMessage');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}
// ============================================
// OTHER SCREEN FUNCTIONS (Placeholders)
// ============================================

function loadPayslipsScreen() {
    document.getElementById('payslipsList').innerHTML = `
        <p style="color: #666; text-align: center; padding: 20px;">
            💰 Payslip viewing coming soon!<br>
            <small>Check back in the next update</small>
        </p>
    `;
}

function loadScheduleScreen() {
    document.getElementById('scheduleList').innerHTML = `
        <p style="color: #666; text-align: center; padding: 20px;">
            📋 Schedule view coming soon!<br>
            <small>Your upcoming shifts will appear here</small>
        </p>
    `;
}

function loadProfileScreen() {
    const employeeName = currentEmployee?.name || currentEmployee?.employee_name || 'Employee';
    document.getElementById('profileInfo').innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <div style="font-size: 48px; margin-bottom: 10px;">👤</div>
            <h3>${employeeName}</h3>
            <p style="color: #666;">${currentEmployee?.designation || 'N/A'}</p>
        </div>
        <div class="hours-row"><span>Employee ID:</span> <span>${config.employeeId}</span></div>
        <div class="hours-row"><span>Department:</span> <span>${currentEmployee?.department || 'N/A'}</span></div>
        <div class="hours-row"><span>Employment Type:</span> <span>${config.employmentType}</span></div>
        <div class="hours-row"><span>Email:</span> <span>${userEmail}</span></div>
    `;
}
