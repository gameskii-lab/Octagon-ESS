const express = require('express');
const cors = require('cors');
const app = express();

// Enhanced CORS configuration
const corsOptions = {
    origin: ['https://octagon-ess.onrender.com', 'http://localhost:3000', 'http://127.0.0.1:5500'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// Explicitly handle preflight requests
app.options('*', cors(corsOptions));

// Configuration
const ERP_URL = process.env.ERP_URL || 'https://erp.octagonerp.net';
const API_KEY = process.env.API_KEY || '';
const API_SECRET = process.env.API_SECRET || '';

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'ERPNext Middleware Running',
        endpoints: ['/api/login', '/api/employee/:email', '/api/shift-assignment/:employeeId', '/api/checkin', '/api/today-checkins/:employeeId']
    });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        const loginResponse = await fetch(`${ERP_URL}/api/method/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usr: email, pwd: password })
        });
        
        const loginResult = await loginResponse.json();
        
        if (loginResponse.ok && loginResult.message === 'Logged In') {
            res.json({ 
                success: true, 
                email: email,
                message: 'Authentication successful'
            });
        } else {
            res.status(401).json({ 
                error: loginResult.message || 'Invalid credentials' 
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Get employee record
app.get('/api/employee/:email', async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'Server API keys not configured' });
    }
    
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Employee?filters=[["user_id","=","${email}"]]&limit=1`,
            {
                headers: {
                    'Authorization': `token ${API_KEY}:${API_SECRET}`
                }
            }
        );
        
        const data = await response.json();
        
        if (response.ok && data.data && data.data.length > 0) {
            const employee = data.data[0];
            res.json({
                success: true,
                employee: {
                    id: employee.name,
                    name: employee.employee_name,
                    department: employee.department,
                    designation: employee.designation,
                    employment_type: employee.employment_type
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
        return res.status(500).json({ error: 'Server API keys not configured' });
    }
    
    try {
        const shiftResponse = await fetch(
            `${ERP_URL}/api/resource/Shift%20Assignment?filters=[["employee","=","${employeeId}"],["start_date","<=","${today}"],["end_date",">=","${today}"]]&limit=1`,
            {
                headers: {
                    'Authorization': `token ${API_KEY}:${API_SECRET}`
                }
            }
        );
        
        const shiftData = await shiftResponse.json();
        
        if (!shiftData.data || shiftData.data.length === 0) {
            return res.json({ success: true, assignment: null });
        }
        
        const assignment = shiftData.data[0];
        
        const shiftTypeResponse = await fetch(
            `${ERP_URL}/api/resource/Shift%20Type/${assignment.shift_type}`,
            {
                headers: {
                    'Authorization': `token ${API_KEY}:${API_SECRET}`
                }
            }
        );
        
        const shiftTypeData = await shiftTypeResponse.json();
        
        let location = null;
        if (shiftTypeData.data && shiftTypeData.data.shift_location) {
            const locationResponse = await fetch(
                `${ERP_URL}/api/resource/Shift%20Location/${shiftTypeData.data.shift_location}`,
                {
                    headers: {
                        'Authorization': `token ${API_KEY}:${API_SECRET}`
                    }
                }
            );
            
            const locationData = await locationResponse.json();
            if (locationData.data) {
                location = {
                    name: locationData.data.location_name,
                    latitude: locationData.data.latitude,
                    longitude: locationData.data.longitude,
                    radius: locationData.data.allowed_radius || 100
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
        return res.status(500).json({ error: 'Server API keys not configured' });
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
                body: JSON.stringify({
                    employee: employeeId,
                    log_type: logType,
                    time: timestamp
                })
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
        return res.status(500).json({ error: 'Server API keys not configured' });
    }
    
    try {
        const response = await fetch(
            `${ERP_URL}/api/resource/Employee%20Checkin?filters=[["employee","=","${employeeId}"],["time","like","${today}%"]]&order_by=time%20asc`,
            {
                headers: {
                    'Authorization': `token ${API_KEY}:${API_SECRET}`
                }
            }
        );
        
        const data = await response.json();
        res.json({ success: true, checkins: data.data || [] });
    } catch (error) {
        console.error('Check-ins fetch error:', error);
        res.status(500).json({ error: 'Server error fetching check-ins' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ERPNext Middleware running on port ${PORT}`);
    console.log(`CORS allowed origins: ${corsOptions.origin.join(', ')}`);
});
