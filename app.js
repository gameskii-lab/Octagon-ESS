// Global state
let currentStatus = 'OUT';
let currentLocation = null;
let sessionToken = null;
let currentEmployee = null;
let todaysAssignment = null;
let config = {
    apiUrl: '',
    employeeId: '',
    employmentType: '',
    siteLat: null,
    siteLng: null,
    siteRadius: 100,
    todaysShift: null,
    shiftLocationName: ''
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    displayDate();
    loadSavedServerUrl();
    getLocation();
    
    const savedToken = localStorage.getItem('sessionToken');
    const savedEmployee = localStorage.getItem('currentEmployee');
    const savedConfig = localStorage.getItem('erpnext_config');
    
    if (savedToken && savedEmployee && savedConfig) {
        sessionToken = savedToken;
        currentEmployee = JSON.parse(savedEmployee);
        config = JSON.parse(savedConfig);
        showAppSection();
        initializeDashboard();
    }
});

function displayDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dateDisplay').textContent = now.toLocaleDateString('en-US', options);
}

function loadSavedServerUrl() {
    const saved = localStorage.getItem('erpnext_config');
    if (saved) {
        config = JSON.parse(saved);
        document.getElementById('serverUrl').value = config.apiUrl || 'https://erpnext-cors-proxy.onrender.com';
    }
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
                document.getElementById('locationDisplay').innerHTML = 
                    `📍 Lat: ${currentLocation.latitude.toFixed(6)}, Lng: ${currentLocation.longitude.toFixed(6)}`;
            },
            (error) => {
                document.getElementById('locationDisplay').textContent = '❌ Location unavailable';
                console.error('Geolocation error:', error);
            }
        );
    } else {
        document.getElementById('locationDisplay').textContent = '❌ Geolocation not supported';
    }
}

async function handleLogin() {
    const serverUrl = document.getElementById('serverUrl').value;
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if (!serverUrl || !email || !password) {
        showStatus('Please fill in all fields', 'error');
        return;
    }
    
    config.apiUrl = serverUrl;
    
    try {
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/method/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usr: email, pwd: password })
        });
        
        const result = await response.json();
        
        if (response.ok && result.message === 'Logged In') {
            sessionToken = result.session_token;
            localStorage.setItem('sessionToken', sessionToken);
            
            await fetchEmployeeByUser(email);
            await fetchTodaysShiftAssignment();
            
            localStorage.setItem('erpnext_config', JSON.stringify(config));
            localStorage.setItem('currentEmployee', JSON.stringify(currentEmployee));
            
            showAppSection();
            initializeDashboard();
            showStatus(`Welcome, ${currentEmployee.employee_name}!`, 'success');
        } else {
            throw new Error(result.message || 'Login failed');
        }
    } catch (error) {
        showStatus(`Login error: ${error.message}`, 'error');
    }
}

async function fetchEmployeeByUser(email) {
    const baseUrl = config.apiUrl.replace(/\/$/, '');
    
    const response = await fetch(
        `${baseUrl}/api/resource/Employee?filters=[["user_id","=","${email}"]]&limit=1`,
        { headers: { 'Authorization': `Bearer ${sessionToken}` } }
    );
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
        currentEmployee = data.data[0];
        config.employeeId = currentEmployee.name;
        config.employmentType = currentEmployee.employment_type || 'Full-time';
        
        document.getElementById('employeeInfo').innerHTML = `
            👤 ${currentEmployee.employee_name}<br>
            🏢 ${currentEmployee.department || 'N/A'}<br>
            💼 ${currentEmployee.designation || 'N/A'}<br>
            <span class="badge ${config.employmentType === 'Daily Wage' ? 'badge-field' : 'badge-office'}">
                ${config.employmentType}
            </span>
        `;
    } else {
        throw new Error('No employee record found for this user');
    }
}

// 🔥 NEW: Fetch today's Shift Assignment and linked Shift Location
async function fetchTodaysShiftAssignment() {
    const baseUrl = config.apiUrl.replace(/\/$/, '');
    const today = new Date().toISOString().split('T')[0];
    
    try {
        // Step 1: Query Shift Assignment for today
        const shiftResponse = await fetch(
            `${baseUrl}/api/resource/Shift%20Assignment?filters=[["employee","=","${config.employeeId}"],["start_date","<=","${today}"],["end_date",">=","${today}"]]&fields=["name","shift_type"]&limit=1`,
            { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
        
        const shiftData = await shiftResponse.json();
        
        if (shiftData.data && shiftData.data.length > 0) {
            const assignment = shiftData.data[0];
            todaysAssignment = assignment;
            config.todaysShift = assignment.shift_type;
            
            // Step 2: Fetch Shift Type details to get Shift Location
            const shiftTypeResponse = await fetch(
                `${baseUrl}/api/resource/Shift%20Type/${assignment.shift_type}`,
                { headers: { 'Authorization': `Bearer ${sessionToken}` } }
            );
            
            const shiftTypeData = await shiftTypeResponse.json();
            
            if (shiftTypeData.data && shiftTypeData.data.shift_location) {
                const shiftLocation = shiftTypeData.data.shift_location;
                
                // Step 3: Fetch Shift Location for geofencing
                const locationResponse = await fetch(
                    `${baseUrl}/api/resource/Shift%20Location/${shiftLocation}`,
                    { headers: { 'Authorization': `Bearer ${sessionToken}` } }
                );
                
                const locationData = await locationResponse.json();
                
                if (locationData.data) {
                    config.siteLat = locationData.data.latitude;
                    config.siteLng = locationData.data.longitude;
                    config.siteRadius = locationData.data.allowed_radius || 100;
                    config.shiftLocationName = locationData.data.location_name;
                    
                    document.getElementById('worksiteDisplay').innerHTML = 
                        `✅ Assigned: ${locationData.data.location_name}<br>
                         📏 Radius: ${config.siteRadius}m<br>
                         🕒 Shift: ${assignment.shift_type}`;
                    
                    document.getElementById('checkBtn').disabled = false;
                } else {
                    document.getElementById('worksiteDisplay').innerHTML = 
                        '⚠️ Worksite location not configured. Contact admin.';
                }
            } else {
                document.getElementById('worksiteDisplay').innerHTML = 
                    '⚠️ No worksite linked to your shift. Using default if available.';
                document.getElementById('checkBtn').disabled = false;
            }
        } else {
            document.getElementById('worksiteDisplay').innerHTML = 
                '⚠️ No shift assigned for today. Contact scheduler.';
            document.getElementById('checkBtn').disabled = true;
        }
    } catch (error) {
        console.error('Error fetching shift assignment:', error);
        document.getElementById('worksiteDisplay').textContent = '❌ Error loading assignment';
        document.getElementById('checkBtn').disabled = true;
    }
}

function showAppSection() {
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('configSection').classList.add('hidden');
    document.getElementById('appSection').classList.remove('hidden');
    
    if (config.employmentType === 'Daily Wage') {
        checkCurrentStatus();
    } else {
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
    const baseUrl = config.apiUrl.replace(/\/$/, '');
    const today = new Date().toISOString().split('T')[0];
    
    try {
        const response = await fetch(
            `${baseUrl}/api/resource/Employee%20Checkin?filters=[["employee","=","${config.employeeId}"],["time","like","${today}%"]]&order_by=time%20asc`,
            { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const hours = calculateHoursFromCheckins(data.data);
            document.getElementById('hoursDisplay').innerHTML = `
                <div class="hours-row"><span>Regular Hours:</span> <span>${hours.regular.toFixed(2)} hrs</span></div>
                <div class="hours-row"><span>Overtime:</span> <span>${hours.overtime.toFixed(2)} hrs</span></div>
                <div class="hours-total"><span>Total:</span> <span>${hours.total.toFixed(2)} hrs</span></div>
            `;
        } else {
            document.getElementById('hoursDisplay').innerHTML = '<p>No check-ins today</p>';
        }
        
        document.getElementById('weekHoursDisplay').innerHTML = `
            <div class="hours-row"><span>This Week:</span> <span>Calculating...</span></div>
            <p style="font-size: 12px; color: #666; margin-top: 8px;">* Full week view coming soon</p>
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
        const today = new Date().toISOString().split('T')[0];
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        const response = await fetch(
            `${baseUrl}/api/resource/Employee%20Checkin?filters=[["employee","=","${config.employeeId}"],["time","like","${today}%"]]&order_by=time%20desc&limit=1`,
            { headers: { 'Authorization': `Bearer ${sessionToken}` } }
        );
        
        if (response.ok) {
            const data = await response.json();
            if (data.data && data.data.length > 0) {
                const lastLog = data.data[0];
                currentStatus = lastLog.log_type;
                updateButtonState();
            }
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

document.getElementById('checkBtn').addEventListener('click', async () => {
    if (!currentLocation) {
        showStatus('Location not available. Please enable GPS.', 'error');
        return;
    }
    
    // Geofencing validation using Shift Location from Shift Assignment
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
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        const now = new Date();
        const timestamp = now.getFullYear() + '-' + 
            String(now.getMonth() + 1).padStart(2, '0') + '-' + 
            String(now.getDate()).padStart(2, '0') + ' ' + 
            String(now.getHours()).padStart(2, '0') + ':' + 
            String(now.getMinutes()).padStart(2, '0') + ':' + 
            String(now.getSeconds()).padStart(2, '0');
        
        const response = await fetch(
            `${baseUrl}/api/resource/Employee%20Checkin`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${sessionToken}`
                },
                body: JSON.stringify({
                    employee: config.employeeId,
                    log_type: logType,
                    time: timestamp
                })
            }
        );
        
        const result = await response.json();
        
        if (response.ok && result.data) {
            currentStatus = logType;
            updateButtonState();
            showStatus(`✅ Successfully checked ${logType.toLowerCase()} at ${now.toLocaleTimeString()}`, 'success');
            
            if (config.employmentType === 'Daily Wage') {
                setTimeout(loadFieldWorkerDashboard, 1000);
            }
        } else {
            const errorMsg = result.message || JSON.stringify(result);
            throw new Error(errorMsg);
        }
    } catch (error) {
        showStatus(`❌ Error: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
    }
});

function applyLeave() {
    showStatus('Leave application feature coming soon!', 'info');
}

function viewPayslips() {
    showStatus('Payslip viewing coming soon!', 'info');
}

function viewSchedule() {
    showStatus('Schedule viewing coming soon!', 'info');
}

function logout() {
    localStorage.removeItem('sessionToken');
    localStorage.removeItem('currentEmployee');
    sessionToken = null;
    currentEmployee = null;
    
    document.getElementById('appSection').classList.add('hidden');
    document.getElementById('loginSection').classList.remove('hidden');
    showStatus('Signed out successfully', 'info');
}

function showConfigSection() {
    document.getElementById('configSection').classList.remove('hidden');
    document.getElementById('apiUrl').value = config.apiUrl || '';
}

function saveConfig() {
    config.apiUrl = document.getElementById('apiUrl').value;
    config.apiKey = document.getElementById('apiKey').value;
    config.apiSecret = document.getElementById('apiSecret').value;
    config.employeeId = document.getElementById('employeeId').value;
    config.siteLat = parseFloat(document.getElementById('siteLat').value) || null;
    config.siteLng = parseFloat(document.getElementById('siteLng').value) || null;
    config.siteRadius = parseInt(document.getElementById('siteRadius').value) || 100;
    
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
