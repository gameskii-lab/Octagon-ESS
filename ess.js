// Global state
let currentStatus = 'OUT';
let currentLocation = null;
let currentEmployee = null;
let userEmail = '';
let config = {
    middlewareUrl: 'https://octagon-ess-production.up.railway.app/',
    employeeId: '',
    employmentType: '',
    siteLat: null,
    siteLng: null,
    siteRadius: 100,
    shiftLocationName: '',
    todaysShift: null
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // 🔥 FORCE LOGIN SCREEN VISIBLE
    const loginScreen = document.getElementById('loginScreen');
    const dashboardScreen = document.getElementById('dashboardScreen');
    const leaveScreen = document.getElementById('leaveScreen');
    const appHeader = document.getElementById('appHeader');
    
    if (loginScreen) loginScreen.style.display = 'block';
    if (dashboardScreen) dashboardScreen.style.display = 'none';
    if (leaveScreen) leaveScreen.style.display = 'none';
    if (appHeader) appHeader.style.display = 'none';
    
    getLocation();
    
    // 🔥 ATTACH CHECK-IN EVENT LISTENER HERE
    const checkBtn = document.getElementById('checkBtn');
    if (checkBtn) {
        checkBtn.addEventListener('click', async () => {
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
                        timestamp: timestamp,
                        latitude: currentLocation.latitude,   
                        longitude: currentLocation.longitude   
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    currentStatus = logType;
                    updateButtonState();
                    showStatus(`✅ Successfully checked ${logType.toLowerCase()} at ${now.toLocaleTimeString()}`, 'success');
                    
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
    }
    
    // Check if already logged in
    const savedConfig = localStorage.getItem('erpnext_config');
    const savedEmployee = localStorage.getItem('currentEmployee');
    const savedEmail = localStorage.getItem('userEmail');
    
    if (savedConfig && savedEmployee && savedEmail) {
        config = JSON.parse(savedConfig);
        currentEmployee = JSON.parse(savedEmployee);
        userEmail = savedEmail;
        
        // Update UI with employee info
        const employeeName = currentEmployee.name || currentEmployee.employee_name || 'Employee';
        const employeeInfoEl = document.getElementById('employeeInfo');
        if (employeeInfoEl) {
            employeeInfoEl.innerHTML = `
                👤 ${employeeName}<br>
                🏢 ${currentEmployee.department || 'N/A'}<br>
                💼 ${currentEmployee.designation || 'N/A'}<br>
                <span class="badge ${config.employmentType === 'Daily Wage' ? 'badge-field' : (config.employmentType === 'Full-time' ? 'badge-office' : 'badge-warning')}">
                    ${config.employmentType || 'Not Set'}
                </span>
            `;
        }
        
        // Update drawer info
        updateDrawerInfo();
        
        // Show app section
        showAppSection();
        
        // Re-fetch today's shift assignment (critical!)
        await fetchTodaysShiftAssignment();
        
        // Initialize the correct dashboard
        initializeDashboard();
        
        showStatus(`Welcome back, ${employeeName}!`, 'success');
    }
});

function displayDate() {
    const dateEl = document.getElementById('dateDisplay');
    if (!dateEl) return;  // 👈 ADD THIS
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateEl.textContent = now.toLocaleDateString('en-US', options);
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
        config.employmentType = currentEmployee.employment_type || 'Daily Wage';
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
                <span class="badge ${config.employmentType === 'Daily Wage' ? 'badge-field' : (config.employmentType === 'Full-time' ? 'badge-office' : 'badge-warning')}">
                    ${config.employmentType || 'Not Set'}
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
    const appHeader = document.getElementById('appHeader');
    
    // Hide login screen
    if (loginScreen) {
        loginScreen.classList.remove('active');
        loginScreen.style.display = 'none';
    }
    
    // Show dashboard screen
    if (dashboardScreen) {
        dashboardScreen.classList.add('active');
        dashboardScreen.style.display = 'block';
    }
    
    // Show header
    if (appHeader) {
        appHeader.classList.add('visible');
        appHeader.style.display = 'flex';
        appHeader.classList.remove('hidden');
    }
    
    document.getElementById('screenTitle').textContent = 'Dashboard';
    
    updateDrawerInfo();
    
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
    
    const attendanceDisplay = document.getElementById('attendanceDisplay');
    if (attendanceDisplay) {
        attendanceDisplay.innerHTML = `
            <p><strong>${month} ${year}</strong></p>
            <div class="hours-row"><span>Present Days:</span> <span>--</span></div>
            <div class="hours-row"><span>Absent Days:</span> <span>--</span></div>
            <p style="font-size: 12px; color: #666; margin-top: 8px;">* Sync in progress</p>
        `;
    }
    
    // The leaveDisplay element doesn't exist in the new design
    // Leave info is now on the separate Leave screen
    const leaveDisplay = document.getElementById('leaveDisplay');
    if (leaveDisplay) {
        leaveDisplay.innerHTML = `
            <div class="hours-row"><span>Annual Leave:</span> <span>-- / 14 days</span></div>
            <div class="hours-row"><span>Sick Leave:</span> <span>-- / 14 days</span></div>
        `;
    }
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
    
    // Hide header
    const appHeader = document.getElementById('appHeader');
    if (appHeader) {
        appHeader.classList.remove('visible');
        appHeader.style.display = 'none';
        appHeader.classList.add('hidden');
    }
    
    // Hide all screens
    const screens = ['dashboardScreen', 'leaveScreen', 'payslipsScreen', 'scheduleScreen', 'profileScreen', 'approvalsScreen'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active');
            el.style.display = 'none';
        }
    });
    
    // Show login screen
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.classList.add('active');
        loginScreen.style.display = 'block';
    }
    
    document.getElementById('screenTitle').textContent = 'Sign In';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    
    showStatus('Signed out successfully', 'info');
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    
    // If status div doesn't exist (e.g., on login screen), just console.log
    if (!statusDiv) {
        console.log(`[${type}] ${message}`);
        return;
    }
    
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        if (statusDiv) {
            statusDiv.textContent = '';
            statusDiv.className = '';
        }
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
    const screens = ['loginScreen', 'dashboardScreen', 'leaveScreen', 'payslipsScreen', 'scheduleScreen', 'profileScreen', 'approvalsScreen', 'onboardingScreen'];
    screens.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('active');
            el.style.display = 'none';
        }
    });
    
    // Show selected screen
    const activeScreen = document.getElementById(screen + 'Screen');
    if (activeScreen) {
        activeScreen.classList.add('active');
        activeScreen.style.display = 'block';
    }
    
    // Update header title
    const titles = {
        'dashboard': 'Dashboard',
        'leave': 'Leave',
        'payslips': 'Payslips',
        'schedule': 'Schedule',
        'profile': 'Profile',
        'approvals': 'Approvals',
        'onboarding': 'Onboarding'
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
    } else if (screen === 'approvals') {
        if (typeof loadApprovalsScreen === 'function') loadApprovalsScreen();
    } else if (screen === 'onboarding') {
        if (typeof loadOnboardingScreen === 'function') loadOnboardingScreen();
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
async function refreshLeaveData() {
    showLeaveStatus('Refreshing leave data...', 'info');
    await loadLeaveBalance();
    await loadLeaveRequests();
    showLeaveStatus('Leave data updated!', 'success');
}

async function loadLeaveScreen() {
    if (!config.employeeId) return;
    await loadLeaveBalance();
    await loadLeaveRequests();
}

async function loadLeaveBalance() {
    try {
        const response = await fetch(`${config.middlewareUrl}/api/leave-balance/${config.employeeId}`);
        const result = await response.json();
        
        console.log('🔍 Leave balance result:', result);
        
        // Get the leave type select element
        const leaveTypeSelect = document.getElementById('leaveType');
        
        if (result.success && result.balances && result.balances.length > 0) {
            // Build leave balance summary
            let html = '';
            result.balances.forEach(b => {
                const remaining = (b.leaves_allocated || 0) - (b.leaves_taken || 0);
                html += `
                    <div class="leave-type">
                        <div class="count">${remaining}</div>
                        <div class="label">${b.leave_type}</div>
                    </div>
                `;
            });
            document.getElementById('leaveBalanceSummary').innerHTML = html;
            
            // 🔥 UPDATE DROPDOWN: Only show allocated leave types
            if (leaveTypeSelect) {
                // Clear existing options
                leaveTypeSelect.innerHTML = '<option value="">Select Leave Type</option>';
                
                // Add only allocated leave types
                result.balances.forEach(b => {
                    const remaining = (b.leaves_allocated || 0) - (b.leaves_taken || 0);
                    if (remaining > 0) {  // Only show if they have remaining balance
                        const option = document.createElement('option');
                        option.value = b.leave_type;
                        option.textContent = `${b.leave_type} (${remaining} days available)`;
                        leaveTypeSelect.appendChild(option);
                    }
                });
                
                // If no options were added, show a message
                if (leaveTypeSelect.options.length === 1) {
                    const option = document.createElement('option');
                    option.value = '';
                    option.textContent = 'No leave types with balance available';
                    option.disabled = true;
                    leaveTypeSelect.appendChild(option);
                }
            }
            
        } else if (result.success && result.balances && result.balances.length === 0) {
            console.log('✅ Showing "No leave allocations"');
            document.getElementById('leaveBalanceSummary').innerHTML = '<p style="text-align: center; padding: 20px;">No leave allocations found</p>';
            
            // 🔥 UPDATE DROPDOWN: Show "No leave types available"
            if (leaveTypeSelect) {
                leaveTypeSelect.innerHTML = '<option value="">No leave types available</option>';
            }
            
        } else {
            console.log('⚠️ API returned unexpected format');
            document.getElementById('leaveBalanceSummary').innerHTML = '<p style="text-align: center; padding: 20px;">Unable to load leave balance</p>';
            
            // Keep default options but disable them
            if (leaveTypeSelect) {
                leaveTypeSelect.innerHTML = '<option value="">Unable to load leave types</option>';
            }
        }
    } catch (error) {
        console.error('Error loading leave balance:', error);
        document.getElementById('leaveBalanceSummary').innerHTML = '<p style="text-align: center; padding: 20px;">Error loading balance</p>';
        
        const leaveTypeSelect = document.getElementById('leaveType');
        if (leaveTypeSelect) {
            leaveTypeSelect.innerHTML = '<option value="">Error loading leave types</option>';
        }
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
    const leaveTypeSelect = document.getElementById('leaveType');
    const leaveType = leaveTypeSelect.options[leaveTypeSelect.selectedIndex]?.value || '';
    const fromDate = document.getElementById('leaveFromDate').value;
    const toDate = document.getElementById('leaveToDate').value;
    const halfDay = document.getElementById('leaveHalfDay').value;
    const reason = document.getElementById('leaveReason').value;
    
    console.log('📝 Submitting:', { leaveType, fromDate, toDate, halfDay, reason });
    
    if (!leaveType || !fromDate || !toDate || !reason) {
        showLeaveStatus('Please fill all fields', 'error');
        return;
    }
    
    const submitBtn = document.querySelector('#leaveScreen button');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
    }
    
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
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Leave Request';
        }
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
// APPROVAL FUNCTIONS
// ============================================
let currentApprovalDoc = null;

async function loadApprovalsScreen() {
    document.getElementById('approvalsList').innerHTML = '<p style="color: #666; text-align: center;">Loading approvals...</p>';
    document.getElementById('approvalDetail').classList.add('hidden');
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/approvals/${encodeURIComponent(userEmail)}`);
        const result = await response.json();
        
        if (result.success && result.approvals && result.approvals.length > 0) {
            let html = '';
            result.approvals.forEach(approval => {
                html += `
                    <div class="leave-request-item" onclick="viewApproval('${approval.doctype}', '${approval.docname}', '${approval.next_action || 'Approve'}')" style="cursor: pointer;">
                        <div style="display: flex; justify-content: space-between;">
                            <div>
                                <strong>${approval.title}</strong>
                                <div style="font-size: 12px; color: #666;">${approval.doctype}</div>
                            </div>
                            <span class="leave-status status-pending">${approval.state || 'Pending'}</span>
                        </div>
                    </div>
                `;
            });
            document.getElementById('approvalsList').innerHTML = html;
        } else {
            document.getElementById('approvalsList').innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No pending approvals</p>';
        }
    } catch (error) {
        document.getElementById('approvalsList').innerHTML = '<p style="color: #666;">Error loading approvals</p>';
    }
}

async function viewApproval(doctype, docname, nextAction) {
    currentApprovalDoc = { doctype, docname, nextAction };
    
    // Show loading
    document.getElementById('approvalDetail').classList.remove('hidden');
    document.getElementById('approvalDetailTitle').textContent = `${doctype}: ${docname}`;
    document.getElementById('approvalPrintView').innerHTML = '<p>Loading document...</p>';
    
    // Update buttons based on available actions
    document.getElementById('approveBtn').style.display = 'block';
    document.getElementById('rejectBtn').style.display = 'block';
    document.getElementById('approveBtn').textContent = `✅ ${nextAction || 'Approve'}`;
    
    // Fetch print format
    try {
        const response = await fetch(`${config.middlewareUrl}/api/print-format/${doctype}/${docname}`);
        const result = await response.json();
        
        if (result.success && result.html) {
            document.getElementById('approvalPrintView').innerHTML = result.html;
        } else {
            document.getElementById('approvalPrintView').innerHTML = '<p>Could not load document view</p>';
        }
    } catch (error) {
        document.getElementById('approvalPrintView').innerHTML = '<p>Error loading document</p>';
    }
    
    // Set up buttons
    document.getElementById('approveBtn').onclick = () => submitWorkflowAction('Approve');
    document.getElementById('rejectBtn').onclick = () => submitWorkflowAction('Reject');
}

function showApprovalsList() {
    document.getElementById('approvalDetail').classList.add('hidden');
    currentApprovalDoc = null;
}

async function submitWorkflowAction(action) {
    if (!currentApprovalDoc) return;
    
    const remark = document.getElementById('approvalRemark').value;
    
    const btn = action === 'Approve' ? document.getElementById('approveBtn') : document.getElementById('rejectBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/workflow-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                doctype: currentApprovalDoc.doctype,
                docname: currentApprovalDoc.docname,
                action: action,
                remark: remark
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showApprovalStatus(`✅ ${action}d successfully!`, 'success');
            document.getElementById('approvalRemark').value = '';
            showApprovalsList();
            // Refresh the list
            setTimeout(loadApprovalsScreen, 500);
        } else {
            throw new Error(result.error || 'Action failed');
        }
    } catch (error) {
        showApprovalStatus(`❌ ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = action === 'Approve' ? `✅ Approve` : `❌ Reject`;
    }
}

function showApprovalStatus(message, type) {
    const statusDiv = document.getElementById('approvalStatusMessage');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}

// ============================================
// ONBOARDING FUNCTIONS
// ============================================

let currentOnboarding = null;
let currentActivity = null;

async function loadOnboardingScreen() {
    if (!config.employeeId) return;
    
    document.getElementById('onboardingActivities').innerHTML = '<p style="color: #666; text-align: center;">Loading...</p>';
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/onboarding/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.onboarding) {
            currentOnboarding = result.onboarding;
            renderOnboarding(result.onboarding);
        } else {
            document.getElementById('onboardingWelcome').textContent = 'No Active Onboarding';
            document.getElementById('onboardingSubtitle').textContent = 'You are not currently in an onboarding program';
            document.getElementById('onboardingActivities').innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Contact HR if you believe this is an error</p>';
        }
    } catch (error) {
        console.error('Onboarding error:', error);
        document.getElementById('onboardingActivities').innerHTML = '<p style="color: #666;">Error loading onboarding</p>';
    }
}

function renderOnboarding(onboarding) {
    // Update welcome
    document.getElementById('onboardingWelcome').textContent = `Welcome, ${onboarding.employee_name || 'New Team Member'}!`;
    document.getElementById('onboardingSubtitle').textContent = onboarding.onboarding_template || 'Let\'s get you set up';
    
    // Update progress
    document.getElementById('onboardingProgress').textContent = `${onboarding.progress}%`;
    document.getElementById('onboardingProgressBar').style.width = `${onboarding.progress}%`;
    document.getElementById('onboardingFraction').textContent = `${onboarding.completedActivities} of ${onboarding.totalActivities} activities complete`;
    
    // Render activities
    if (onboarding.activities && onboarding.activities.length > 0) {
        let html = '';
        onboarding.activities.forEach(activity => {
            const isComplete = activity.completion_status === 'Completed';
            const statusIcon = isComplete ? '✅' : '⬜';
            const statusClass = isComplete ? 'status-approved' : 'status-pending';
            
            html += `
                <div class="leave-request-item" onclick="viewOnboardingActivity('${escapeHtml(activity.activity_name)}', '${escapeHtml(activity.description || '')}', ${isComplete})" style="cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="font-size: 20px; margin-right: 10px;">${statusIcon}</span>
                            <strong>${activity.activity_name}</strong>
                            ${activity.responsible ? `<div style="font-size: 12px; color: #666;">Responsible: ${activity.responsible}</div>` : ''}
                        </div>
                        <span class="leave-status ${statusClass}">${activity.completion_status}</span>
                    </div>
                </div>
            `;
        });
        document.getElementById('onboardingActivities').innerHTML = html;
    } else {
        document.getElementById('onboardingActivities').innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No activities defined in the onboarding template</p>';
    }
}

function viewOnboardingActivity(name, description, isComplete) {
    currentActivity = { name, description, isComplete };
    
    document.getElementById('onboardingDetail').classList.remove('hidden');
    document.getElementById('onboardingDetailTitle').textContent = name;
    document.getElementById('onboardingDetailContent').innerHTML = `
        <p style="margin-bottom: 16px;">${description || 'No additional details provided'}</p>
        <div style="font-size: 14px; color: #666;">
            Status: <span class="leave-status ${isComplete ? 'status-approved' : 'status-pending'}">${isComplete ? 'Completed' : 'Pending'}</span>
        </div>
    `;
    
    const completeBtn = document.getElementById('onboardingCompleteBtn');
    if (isComplete) {
        completeBtn.style.display = 'none';
    } else {
        completeBtn.style.display = 'block';
        completeBtn.onclick = () => completeOnboardingActivity(name);
    }
    
    // Scroll to detail
    document.getElementById('onboardingDetail').scrollIntoView({ behavior: 'smooth' });
}

function hideOnboardingDetail() {
    document.getElementById('onboardingDetail').classList.add('hidden');
    currentActivity = null;
}

async function completeOnboardingActivity(activityName) {
    const btn = document.getElementById('onboardingCompleteBtn');
    btn.disabled = true;
    btn.textContent = 'Completing...';
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/onboarding/complete-activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employeeId: currentOnboarding.name,
                activityName: activityName
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showOnboardingStatus('✅ Activity completed!', 'success');
            hideOnboardingDetail();
            // Reload onboarding data
            setTimeout(() => loadOnboardingScreen(), 500);
        } else {
            throw new Error(result.error || 'Failed to complete activity');
        }
    } catch (error) {
        showOnboardingStatus(`❌ ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ Mark as Complete';
    }
}

function showOnboardingStatus(message, type) {
    const statusDiv = document.getElementById('onboardingStatusMessage');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ============================================
// PAYSLIP FUNCTIONS
// ============================================

let currentPayslipDoc = null;

async function loadPayslipsScreen() {
    if (!config.employeeId) return;
    
    document.getElementById('payslipsList').innerHTML = '<p style="color: #666; text-align: center;">Loading payslips...</p>';
    document.getElementById('payslipDetail').classList.add('hidden');
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/payslips/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success && result.payslips && result.payslips.length > 0) {
            // Show latest payslip card
            const latest = result.payslips[0];
            const latestCard = document.getElementById('latestPayslipCard');
            const latestContent = document.getElementById('latestPayslipContent');
            
            latestCard.classList.remove('hidden');
            latestContent.innerHTML = `
                <div style="font-size: 28px; font-weight: bold; color: #155724; margin-bottom: 4px;">
                    ${formatCurrency(latest.net_pay)}
                </div>
                <div style="font-size: 14px; color: #666;">
                    ${latest.period} • Net Pay
                </div>
                <div style="font-size: 12px; color: #999; margin-top: 4px;">
                    Gross: ${formatCurrency(latest.gross_pay)} • Deductions: ${formatCurrency(latest.total_deduction)}
                </div>
                <button onclick="viewPayslipDetail('${latest.name}')" style="margin-top: 10px; padding: 8px 20px; font-size: 14px; width: auto; background: #1a73e8;">
                    View Payslip
                </button>
            `;
            
            // Build list
            let html = '';
            result.payslips.forEach(slip => {
                html += `
                    <div class="leave-request-item" onclick="viewPayslipDetail('${slip.name}')" style="cursor: pointer;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <strong>${slip.period}</strong>
                                <div style="font-size: 12px; color: #666;">
                                    Gross: ${formatCurrency(slip.gross_pay)} • Ded: ${formatCurrency(slip.total_deduction)}
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-weight: bold; color: #155724;">${formatCurrency(slip.net_pay)}</div>
                                <span class="leave-status status-approved">${slip.status || 'Paid'}</span>
                            </div>
                        </div>
                    </div>
                `;
            });
            document.getElementById('payslipsList').innerHTML = html;
        } else {
            document.getElementById('latestPayslipCard').classList.add('hidden');
            document.getElementById('payslipsList').innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No payslips found</p>';
        }
    } catch (error) {
        console.error('Payslips error:', error);
        document.getElementById('payslipsList').innerHTML = '<p style="color: #666;">Error loading payslips</p>';
    }
}

async function viewPayslipDetail(payslipName) {
    currentPayslipDoc = payslipName;
    
    document.getElementById('payslipDetail').classList.remove('hidden');
    document.getElementById('payslipDetailTitle').textContent = `Payslip: ${payslipName}`;
    document.getElementById('payslipPrintView').innerHTML = '<p style="text-align: center; padding: 20px;">Loading payslip...</p>';
    
    // Scroll to detail view
    document.getElementById('payslipDetail').scrollIntoView({ behavior: 'smooth' });
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/payslip-print/${payslipName}`);
        const result = await response.json();
        
        if (result.success && result.html) {
            document.getElementById('payslipPrintView').innerHTML = result.html;
        } else {
            document.getElementById('payslipPrintView').innerHTML = '<p style="text-align: center; padding: 20px;">Could not load payslip view</p>';
        }
    } catch (error) {
        document.getElementById('payslipPrintView').innerHTML = '<p style="text-align: center; padding: 20px;">Error loading payslip</p>';
    }
}

function hidePayslipDetail() {
    document.getElementById('payslipDetail').classList.add('hidden');
    currentPayslipDoc = null;
}

function downloadPayslip() {
    if (!currentPayslipDoc) return;
    
    // Open print format in new tab for download
    window.open(`https://octagon-ess-middleware-rl71.onrender.com/api/payslip-print/${currentPayslipDoc}`, '_blank');
    
    showPayslipStatus('Opening payslip for download...', 'info');
}

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BND' }).format(amount);
}

function showPayslipStatus(message, type) {
    const statusDiv = document.getElementById('payslipStatusMessage');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}

// ============================================
// SCHEDULE FUNCTIONS (Calendar View)
// ============================================

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let scheduleData = { shifts: [], leaves: [], holidays: [] };

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    } else if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    renderCalendar();
}

async function loadScheduleScreen() {
    if (!config.employeeId) return;
    
    document.getElementById('scheduleList').innerHTML = '<p style="color: #666; text-align: center;">Loading...</p>';
    
    try {
        const response = await fetch(`${config.middlewareUrl}/api/schedule/${config.employeeId}`);
        const result = await response.json();
        
        if (result.success) {
            scheduleData = result;
            currentMonth = new Date().getMonth();
            currentYear = new Date().getFullYear();
            renderCalendar();
            renderUpcomingShifts();
        } else {
            document.getElementById('scheduleList').innerHTML = '<p style="color: #666;">Unable to load schedule</p>';
        }
    } catch (error) {
        console.error('Schedule error:', error);
        document.getElementById('scheduleList').innerHTML = '<p style="color: #666;">Error loading schedule</p>';
    }
}

function renderCalendar() {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    document.getElementById('calendarMonth').textContent = `${monthNames[currentMonth]} ${currentYear}`;
    
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const today = new Date().toISOString().split('T')[0];
    
    let gridHTML = '';
    let dayCount = 0;
    
    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
        gridHTML += '<div></div>';
        dayCount++;
    }
    
    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        // Determine day status
        let status = 'off';
        let label = '';
        
        // Check if work day
        for (const shift of scheduleData.shifts) {
            if (dateStr >= shift.start_date && dateStr <= shift.end_date) {
                status = 'work';
                label = shift.shift_type || 'Shift';
                break;
            }
        }
        
        // Check if leave day
        for (const leave of scheduleData.leaves) {
            if (dateStr >= leave.from_date && dateStr <= leave.to_date) {
                status = 'leave';
                label = leave.leave_type || 'Leave';
                break;
            }
        }
        
        // Check if holiday
        for (const holiday of scheduleData.holidays) {
            if (dateStr === holiday.holiday_date) {
                status = 'holiday';
                label = holiday.description || 'Holiday';
                break;
            }
        }
        
        // Status colors
        const statusColors = {
            'work': { bg: '#d4edda', dot: '#4CAF50', text: '#155724' },
            'leave': { bg: '#fff3cd', dot: '#ffc107', text: '#856404' },
            'holiday': { bg: '#f8d7da', dot: '#f44336', text: '#721c24' },
            'off': { bg: '#f5f5f5', dot: '#ccc', text: '#999' }
        };
        
        const colors = statusColors[status];
        const isToday = dateStr === today;
        
        gridHTML += `
            <div onclick="showDayDetail('${dateStr}')" style="
                padding: 6px 2px;
                border-radius: 8px;
                background: ${colors.bg};
                cursor: pointer;
                text-align: center;
                ${isToday ? 'border: 2px solid #2196F3;' : ''}
                transition: transform 0.1s;
            " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                <div style="font-size: 13px; font-weight: ${isToday ? 'bold' : 'normal'}; color: ${colors.text};">${day}</div>
                <div style="width: 8px; height: 8px; border-radius: 50%; background: ${colors.dot}; margin: 3px auto 0;"></div>
                ${label ? `<div style="font-size: 9px; color: ${colors.text}; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</div>` : ''}
            </div>
        `;
        
        dayCount++;
    }
    
    document.getElementById('calendarGrid').innerHTML = gridHTML;
}

function showDayDetail(dateStr) {
    const detail = document.getElementById('dayDetail');
    const title = document.getElementById('dayDetailTitle');
    const content = document.getElementById('dayDetailContent');
    
    title.textContent = `📅 ${dateStr}`;
    
    let html = '';
    let found = false;
    
    // Check shifts
    for (const shift of scheduleData.shifts) {
        if (dateStr >= shift.start_date && dateStr <= shift.end_date) {
            found = true;
            html += `
                <div class="leave-request-item" style="border-left: 4px solid #4CAF50;">
                    <strong>🟢 Work Day</strong><br>
                    <span>Shift: ${shift.shift_type || 'Assigned'}</span><br>
                    ${shift.shift_location ? `<span>📍 ${shift.shift_location}</span>` : ''}
                </div>
            `;
        }
    }
    
    // Check leaves
    for (const leave of scheduleData.leaves) {
        if (dateStr >= leave.from_date && dateStr <= leave.to_date) {
            found = true;
            html += `
                <div class="leave-request-item" style="border-left: 4px solid #ffc107;">
                    <strong>🟡 Leave Day</strong><br>
                    <span>Type: ${leave.leave_type}</span>
                </div>
            `;
        }
    }
    
    // Check holidays
    for (const holiday of scheduleData.holidays) {
        if (dateStr === holiday.holiday_date) {
            found = true;
            html += `
                <div class="leave-request-item" style="border-left: 4px solid #f44336;">
                    <strong>🔴 Holiday</strong><br>
                    <span>${holiday.description}</span>
                </div>
            `;
        }
    }
    
    if (!found) {
        html = '<p style="color: #666; text-align: center; padding: 20px;">⚪ No schedule for this day</p>';
    }
    
    content.innerHTML = html;
    detail.classList.remove('hidden');
    
    // Hide calendar and upcoming shifts
    const calendarCard = document.getElementById('calendarGrid').closest('.card');
    const scheduleCard = document.getElementById('scheduleList').closest('.card');
    if (calendarCard) calendarCard.style.display = 'none';
    if (scheduleCard) scheduleCard.style.display = 'none';
}

function hideDayDetail() {
    document.getElementById('dayDetail').classList.add('hidden');
    
    // Show calendar and upcoming shifts
    const calendarCard = document.getElementById('calendarGrid').closest('.card');
    const scheduleCard = document.getElementById('scheduleList').closest('.card');
    if (calendarCard) calendarCard.style.display = 'block';
    if (scheduleCard) scheduleCard.style.display = 'block';
}

function renderUpcomingShifts() {
    let html = '';
    
    if (scheduleData.shifts && scheduleData.shifts.length > 0) {
        scheduleData.shifts.slice(0, 5).forEach(shift => {
            html += `
                <div class="leave-request-item">
                    <div style="display: flex; justify-content: space-between;">
                        <strong>${shift.shift_type || 'Shift'}</strong>
                        <span class="leave-status status-approved">Confirmed</span>
                    </div>
                    <div style="font-size: 14px; color: #666; margin-top: 4px;">
                        📅 ${shift.start_date} to ${shift.end_date}
                    </div>
                    ${shift.shift_location ? `
                    <div style="font-size: 14px; color: #666;">
                        📍 ${shift.shift_location}
                    </div>` : ''}
                </div>
            `;
        });
    } else {
        html = '<p style="color: #666; text-align: center; padding: 20px;">No upcoming shifts</p>';
    }
    
    document.getElementById('scheduleList').innerHTML = html;
}

function loadProfileScreen() {
    const profileInfoEl = document.getElementById('profileInfo');
    
    if (!profileInfoEl) {
        console.log('Profile info element not found');
        return;
    }
    
    const employeeName = currentEmployee?.name || currentEmployee?.employee_name || 'Employee';
    profileInfoEl.innerHTML = `
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
