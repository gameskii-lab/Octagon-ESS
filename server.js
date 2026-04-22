const express = require('express');
const cors = require('cors');
const app = express();

// CORS configuration - Allow your frontend
app.use(cors({
    origin: ['https://octagon-ess.onrender.com', 'http://localhost:3000', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path} - Origin: ${req.headers.origin || 'none'}`);
    next();
});

// Configuration from environment variables
const ERP_URL = process.env.ERP_URL || 'https://erp.octagonerp.net';
const API_KEY = process.env.API_KEY || '';
const API_SECRET = process.env.API_SECRET || '';

// Root endpoint - Shows service status
app.get('/', (req, res) => {
    res.json({ 
        status: 'Octagon ESS Middleware Running',
        version: '1.0.2',
        endpoints: [
            '/ping',
            '/api/login',
            '/api/employee/:email',
            '/api/shift-assignment/:employeeId',
            '/api/checkin',
            '/api/today-checkins/:employeeId',
            '/api/leave-balance/:employeeId',
            '/api/leave-requests/:employeeId',
            '/api/leave-application'
        ]
    });
});

// Ping endpoint - Health check
app.get('/ping', (req, res) => {
    res.json({ pong: true, time: new Date().toISOString() });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    try {
        const response = await fetch(`${ERP_URL}/api/method/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usr: email, pwd: password })
        });
        const result = await response.json();
        if (response.ok && result.message === 'Logged In') {
            res.json({ success: true, email: email });
        } else {
            res.status(401).json({ error: result.message || 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get employee record by email
app.get('/api/employee/:email', async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Employee?filters=[["user_id","=","${email}"]]&limit=1`,
            { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
        );
        const data = await response.json();
        if (data.data && data.data.length > 0) {
            const emp = data.data[0];
            const employeeName = emp.employee_name || emp.name || 
                (emp.first_name && emp.last_name ? `${emp.first_name} ${emp.last_name}` : 'Employee');
            res.json({
                success: true,
                employee: {
                    id: emp.name,
                    name: employeeName,
                    employee_name: employeeName,
                    department: emp.department || 'N/A',
                    designation: emp.designation || 'N/A',
                    employment_type: emp.employment_type || 'Full-time'
                }
            });
        } else {
            res.status(404).json({ error: 'No employee record found for this user' });
        }
    } catch (error) {
        console.error('Employee fetch error:', error);
        res.status(500).json({ error: 'Server error fetching employee' });
    }
});

// Get today's shift assignment
app.get('/api/shift-assignment/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    const today = new Date().toISOString().split('T')[0];
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const shiftRes = await fetch(
            `${ERP_URL}/api/resource/Shift%20Assignment?filters=[["employee","=","${employeeId}"],["start_date","<=","${today}"],["end_date",">=","${today}"]]&limit=1`,
            { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
        );
        const shiftData = await shiftRes.json();
        if (!shiftData.data || shiftData.data.length === 0) {
            return res.json({ success: true, assignment: null });
        }
        const assignment = shiftData.data[0];
        const typeRes = await fetch(
            `${ERP_URL}/api/resource/Shift%20Type/${assignment.shift_type}`,
            { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
        );
        const typeData = await typeRes.json();
        let location = null;
        if (typeData.data && typeData.data.shift_location) {
            const locRes = await fetch(
                `${ERP_URL}/api/resource/Shift%20Location/${typeData.data.shift_location}`,
                { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
            );
            const locData = await locRes.json();
            if (locData.data) {
                location = {
                    name: locData.data.location_name,
                    latitude: locData.data.latitude,
                    longitude: locData.data.longitude,
                    radius: locData.data.allowed_radius || 100
                };
            }
        }
        res.json({
            success: true,
            assignment: {
                shift_type: assignment.shift_type,
                start_date: assignment.start_date,
                end_date: assignment.end_date,
                location: location
            }
        });
    } catch (error) {
        console.error('Shift assignment error:', error);
        res.status(500).json({ error: 'Server error fetching shift assignment' });
    }
});

// Create check-in
app.post('/api/checkin', async (req, res) => {
    const { employeeId, logType, timestamp } = req.body;
    if (!employeeId || !logType || !timestamp) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Employee%20Checkin`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `token ${API_KEY}:${API_SECRET}`
                },
                body: JSON.stringify({ employee: employeeId, log_type: logType, time: timestamp })
            }
        );
        const result = await response.json();
        if (response.ok && result.data) {
            res.json({ success: true, data: result.data });
        } else {
            res.status(400).json({ error: result.message || 'Check-in failed' });
        }
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ error: 'Server error during check-in' });
    }
});

// Get today's check-ins
app.get('/api/today-checkins/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    const today = new Date().toISOString().split('T')[0];
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Employee%20Checkin?filters=[["employee","=","${employeeId}"],["time","like","${today}%"]]&order_by=time%20asc`,
            { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
        );
        const data = await response.json();
        res.json({ success: true, checkins: data.data || [] });
    } catch (error) {
        console.error('Check-ins fetch error:', error);
        res.status(500).json({ error: 'Server error fetching check-ins' });
    }
});

// ============================================
// LEAVE ENDPOINTS
// ============================================

// Get leave balance
app.get('/api/leave-balance/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Leave%20Allocation?filters=[["employee","=","${employeeId}"],["docstatus","=",1]]&fields=["leave_type","total_leaves_allocated","leaves_taken"]`,
            { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
        );
        const data = await response.json();
        const balances = (data.data || []).map(alloc => ({
            leave_type: alloc.leave_type,
            leaves_allocated: alloc.total_leaves_allocated || 0,
            leaves_taken: alloc.leaves_taken || 0
        }));
        res.json({ success: true, balances });
    } catch (error) {
        console.error('Leave balance error:', error);
        res.status(500).json({ error: 'Server error fetching leave balance' });
    }
});

// Get leave requests
app.get('/api/leave-requests/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Leave%20Application?filters=[["employee","=","${employeeId}"]]&fields=["leave_type","from_date","to_date","status","total_leave_days"]&order_by=creation%20desc&limit=10`,
            { headers: { 'Authorization': `token ${API_KEY}:${API_SECRET}` } }
        );
        const data = await response.json();
        res.json({ success: true, requests: data.data || [] });
    } catch (error) {
        console.error('Leave requests error:', error);
        res.status(500).json({ error: 'Server error fetching leave requests' });
    }
});

// Submit leave application
app.post('/api/leave-application', async (req, res) => {
    const { employeeId, leaveType, fromDate, toDate, halfDay, halfDayDate, reason } = req.body;
    if (!employeeId || !leaveType || !fromDate || !toDate) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    try {
        const payload = {
            employee: employeeId,
            leave_type: leaveType,
            from_date: fromDate,
            to_date: toDate,
            description: reason || 'Applied via ESS',
            status: 'Open'
        };
        if (halfDay) {
            payload.half_day = 1;
            payload.half_day_date = halfDayDate || fromDate;
        }
        const response = await fetch(
            `${ERP_URL}/api/resource/Leave%20Application`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `token ${API_KEY}:${API_SECRET}`
                },
                body: JSON.stringify(payload)
            }
        );
        const result = await response.json();
        if (response.ok && result.data) {
            res.json({ success: true, data: result.data });
        } else {
            res.status(400).json({ error: result.message || 'Failed to submit leave application' });
        }
    } catch (error) {
        console.error('Leave application error:', error);
        res.status(500).json({ error: 'Server error submitting leave application' });
    }
});

// 404 handler
app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 ERP_URL: ${ERP_URL}`);
    console.log(`🔑 API_KEY configured: ${API_KEY ? 'YES' : 'NO'}`);
});
