// Global state
let currentStatus = 'OUT'; // 'IN' or 'OUT'
let currentLocation = null;
let config = {
    apiUrl: '',
    apiKey: '',
    apiSecret: '',
    employeeId: '',
    siteLat: null,
    siteLng: null,
    siteRadius: 100
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    displayDate();
    loadConfig();
    getLocation();
});

// Display current date
function displayDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dateDisplay').textContent = now.toLocaleDateString('en-US', options);
}

// Calculate distance between two coordinates in meters (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in meters
}

// Load saved config from localStorage
function loadConfig() {
    const saved = localStorage.getItem('erpnext_config');
    if (saved) {
        config = JSON.parse(saved);
        document.getElementById('apiUrl').value = config.apiUrl || '';
        document.getElementById('apiKey').value = config.apiKey || '';
        document.getElementById('apiSecret').value = config.apiSecret || '';
        document.getElementById('employeeId').value = config.employeeId || '';
        document.getElementById('siteLat').value = config.siteLat || '';
        document.getElementById('siteLng').value = config.siteLng || '';
        document.getElementById('siteRadius').value = config.siteRadius || 100;
        
        if (config.apiUrl && config.apiKey && config.apiSecret && config.employeeId) {
            fetchEmployeeInfo();
        }
    }
}

// Save config to localStorage
function saveConfig() {
    config.apiUrl = document.getElementById('apiUrl').value;
    config.apiKey = document.getElementById('apiKey').value;
    config.apiSecret = document.getElementById('apiSecret').value;
    config.employeeId = document.getElementById('employeeId').value;
    config.siteLat = parseFloat(document.getElementById('siteLat').value) || null;
    config.siteLng = parseFloat(document.getElementById('siteLng').value) || null;
    config.siteRadius = parseInt(document.getElementById('siteRadius').value) || 100;
    
    localStorage.setItem('erpnext_config', JSON.stringify(config));
    fetchEmployeeInfo();
    showStatus('Configuration saved!', 'success');
}

// Fetch employee details from ERPNext
async function fetchEmployeeInfo() {
    try {
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/resource/Employee/${config.employeeId}`, {
            headers: {
                'Authorization': `token ${config.apiKey}:${config.apiSecret}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            document.getElementById('employeeInfo').innerHTML = `
                👤 ${data.data.employee_name}<br>
                🏢 ${data.data.department || 'N/A'}<br>
                💼 ${data.data.designation || 'N/A'}
            `;
            document.getElementById('checkBtn').disabled = false;
            checkCurrentStatus();
        } else {
            document.getElementById('employeeInfo').textContent = 'Invalid Employee ID or credentials';
            document.getElementById('checkBtn').disabled = true;
        }
    } catch (error) {
        console.error('Error fetching employee:', error);
        document.getElementById('employeeInfo').textContent = 'Connection error - check CORS settings';
    }
}

// Check if employee is currently checked in
async function checkCurrentStatus() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        const response = await fetch(
            `${baseUrl}/api/resource/Employee%20Checkin?filters=[["employee","=","${config.employeeId}"],["time","like","${today}%"]]&order_by=time%20desc&limit=1`,
            {
                headers: {
                    'Authorization': `token ${config.apiKey}:${config.apiSecret}`
                }
            }
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

// Get device location
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

// Update button based on current status
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
                `📍 You are ${Math.round(distance)}m from worksite. Allowed: ${config.siteRadius}m. Check-in denied.`,
                'error'
            );
            return;
        }
        
        console.log(`✅ Distance to worksite: ${Math.round(distance)}m (within ${config.siteRadius}m limit)`);
    }
    
    const btn = document.getElementById('checkBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    
    const logType = currentStatus === 'IN' ? 'OUT' : 'IN';
    
    try {
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        
        // Format timestamp as "YYYY-MM-DD HH:MM:SS"
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
                    'Authorization': `token ${config.apiKey}:${config.apiSecret}`
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

// Show status message
function showStatus(message, type) {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.className = `status ${type}`;
    statusDiv.textContent = message;
    setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
    }, 5000);
}
