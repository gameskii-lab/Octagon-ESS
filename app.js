// Global state
let currentStatus = 'OUT'; // 'IN' or 'OUT'
let currentLocation = null;
let config = {
    apiUrl: '',
    apiKey: '',
    apiSecret: '',
    employeeId: ''
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

// Load saved config from localStorage
function loadConfig() {
    const saved = localStorage.getItem('erpnext_config');
    if (saved) {
        config = JSON.parse(saved);
        document.getElementById('apiUrl').value = config.apiUrl || '';
        document.getElementById('apiKey').value = config.apiKey || '';
        document.getElementById('apiSecret').value = config.apiSecret || '';
        document.getElementById('employeeId').value = config.employeeId || '';
        
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
    
    localStorage.setItem('erpnext_config', JSON.stringify(config));
    fetchEmployeeInfo();
    showStatus('Configuration saved!', 'success');
}

// Fetch employee details from ERPNext
async function fetchEmployeeInfo() {
    try {
        // Fix: Remove trailing slash from apiUrl
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
        // Fix: Remove trailing slash from apiUrl
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
    
    const btn = document.getElementById('checkBtn');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    
    const logType = currentStatus === 'IN' ? 'OUT' : 'IN';
    
    try {
        // Fix: Remove trailing slash from apiUrl
        const baseUrl = config.apiUrl.replace(/\/$/, '');
        const response = await fetch(
            `${baseUrl}/api/method/erpnext.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `token ${config.apiKey}:${config.apiSecret}`
                },
                body: JSON.stringify({
                    employee: config.employeeId,
                    log_type: logType,
                    latitude: currentLocation.latitude,
                    longitude: currentLocation.longitude
                })
            }
        );
        
        const result = await response.json();
        
        if (response.ok && result.message) {
            currentStatus = logType;
            updateButtonState();
            showStatus(`Successfully checked ${logType.toLowerCase()} at ${new Date().toLocaleTimeString()}`, 'success');
        } else {
            throw new Error(result.message || 'Check-in failed');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
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
