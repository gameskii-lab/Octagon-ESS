// Global state
let currentStatus = 'OUT';
let currentLocation = null;
let currentEmployee = null;
let userEmail = '';
let config = {
    middlewareUrl: 'https://erpnext-middleware.onrender.com',
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

function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
                const locationEl = document.getElementById('locationDisplay');
                if (locationEl) {
                    locationEl.innerHTML = `📍 Lat: ${currentLocation.latitude.toFixed(6)}, Lng: ${currentLocation.longitude.toFixed(6)}`;
                }
            },
            (error) => {
                const locationEl = document.getElementById('locationDisplay');
                if (locationEl) {
                    locationEl.textContent = '❌ Location unavailable';
                }
                console.error('Geolocation error:', error);
            }
        );
    } else {
        const locationEl = document.getElementById('locationDisplay');
        if (locationEl) {
            locationEl.textContent = '❌ Geolocation not supported';
        }
    }
}

// Handle login with email and password
async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!email || !password) {
        showStatus('Please enter email and password', 'error');
        return;
    }
    
    const loginBtn = document.querySelector('#loginSection button');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    
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
        
        // Store for persistence
        localStorage.setItem('erpnext_config', JSON.stringify(config));
        localStorage.setItem('currentEmployee', JSON.stringify(currentEmployee));
        localStorage.setItem('userEmail', userEmail);
        
        // Step 3: Fetch today's shift assignment
        await fetchTodaysShiftAssignment();
        
        // Update UI
        document.getElementById('employeeInfo').innerHTML = `
            👤 ${currentEmployee.name}<br>
            🏢 ${currentEmployee.department || 'N/A'}<br>
            💼 ${currentEmployee.designation || 'N/A'}<br>
            <span class="badge ${config.employmentType === 'Daily Wage' ? 'badge-field' : 'badge-office'}">
                ${config.employmentType}
            </span>
        `;
        
        showAppSection();
        initializeDashboard();
        showStatus(`Welcome, ${currentEmployee.name}!`, 'success');
        
    } catch (error) {
        console.error('Login error:', error);
        showStatus(`Login error: ${error.message}`, 'error');
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
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

function showAppSection() {
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('configSection').classList.add('hidden');
    document.getElementById('appSection').classList.remove('hidden');
    
    if (config.employmentType !== 'Daily Wage') {
        document.getElementById('checkBtn').style.display = 'none';
        document.getElementById('worksiteDisplay').textContent = '🏢 Office-based employee';
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
    localStorage.removeItem('erpnext_config');
    localStorage.removeItem('currentEmployee');
    localStorage.removeItem('userEmail');
    
    currentEmployee = null;
    userEmail = '';
    config.employeeId = '';
    
    document.getElementById('appSection').classList.add('hidden');
    document.getElementById('loginSection').classList.remove('hidden');
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    
    showStatus('Signed out successfully', 'info');
}

function showConfigSection() {
    document.getElementById('configSection').classList.remove('hidden');
}

function saveConfig() {
    const middlewareUrl = document.getElementById('middlewareUrl').value;
    if (middlewareUrl) {
        config.middlewareUrl = middlewareUrl;
    }
    localStorage.setItem('erpnext_config', JSON.stringify(config));
    showStatus('Configuration saved!', 'success');
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}
