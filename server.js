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

// ============================================
// CACHING LAYER (for GET requests only)
// ============================================
const cache = {};
const CACHE_TTL = 60000; // 1 minute cache for GET requests

function getCached(key) {
    const entry = cache[key];
    if (entry && Date.now() - entry.time < CACHE_TTL) {
        console.log(`✅ Cache hit: ${key.substring(0, 80)}...`);
        return entry.data;
    }
    return null;
}

function setCache(key, data) {
    cache[key] = { data, time: Date.now() };
}

// Helper: Make cached GET requests (returns a mock response-like object)
async function cachedGet(url, headers) {
    const cacheKey = url;
    const cached = getCached(cacheKey);
    
    if (cached) {
        return {
            ok: true,
            status: 200,
            json: async () => cached
        };
    }
    
    console.log(`🌐 Fetching: ${url.substring(0, 80)}...`);
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (response.ok) {
        setCache(cacheKey, data);
    }
    
    return {
        ok: response.ok,
        status: response.status,
        json: async () => data
    };
}

// ============================================
// CONFIGURATION
// ============================================
const ERP_URL = process.env.ERP_URL || 'https://erp.octagonerp.net';
const API_KEY = process.env.API_KEY || '';
const API_SECRET = process.env.API_SECRET || '';

// ============================================
// ROOT & HEALTH ENDPOINTS
// ============================================

app.get('/', (req, res) => {
    res.json({ 
        status: 'Octagon ESS Middleware Running',
        version: '1.0.3',
        endpoints: [
            '/ping',
            '/api/login',
            '/api/employee/:email',
            '/api/shift-assignment/:employeeId',
            '/api/checkin',
            '/api/today-checkins/:employeeId',
            '/api/leave-balance/:employeeId',
            '/api/leave-requests/:employeeId',
            '/api/leave-application',
            '/api/approvals/:email',
            '/api/print-format/:doctype/:docname'
        ]
    });
});

app.get('/ping', (req, res) => {
    res.json({ pong: true, time: new Date().toISOString() });
});

// ============================================
// AUTH ENDPOINTS (No Cache - Real-time)
// ============================================

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

// ============================================
// EMPLOYEE ENDPOINTS (Cached GET)
// ============================================

app.get('/api/employee/:email', async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Employee?filters=[["user_id","=","${email}"]]&fields=["name","employee_name","department","designation","employment_type"]&limit=1`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            const emp = data.data[0];
            const employeeName = emp.employee_name || emp.name || 'Employee';
            
            res.json({
                success: true,
                employee: {
                    id: emp.name,
                    name: employeeName,
                    employee_name: employeeName,
                    department: emp.department || 'N/A',
                    designation: emp.designation || 'N/A',
                    employment_type: emp.employment_type || 'Daily Wage'
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

// ============================================
// SHIFT ASSIGNMENT ENDPOINTS (Cached GET)
// ============================================

// Get today's shift assignment
// Get today's shift assignment
app.get('/api/shift-assignment/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`🔍 Shift assignment for ${employeeId} on ${today}`);
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        // Fetch shift assignment with ALL fields including shift_location
        const shiftResponse = await cachedGet(
            `${ERP_URL}/api/resource/Shift%20Assignment?filters=[["employee","=","${employeeId}"],["start_date","<=","${today}"],["end_date",">=","${today}"]]&fields=["*"]&limit=1`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const shiftData = await shiftResponse.json();
        
        console.log(`📊 Shift Assignment found:`, shiftData.data?.length || 0);
        
        if (!shiftData.data || shiftData.data.length === 0) {
            return res.json({ success: true, assignment: null });
        }
        
        const assignment = shiftData.data[0];
        console.log(`  Shift Type: ${assignment.shift_type}`);
        console.log(`  Shift Location field: ${assignment.shift_location}`);
        
        let location = null;
        
        // If shift assignment has a direct shift_location field, use it
        if (assignment.shift_location) {
            console.log(`  Fetching location: ${assignment.shift_location}`);
            const locResponse = await cachedGet(
                `${ERP_URL}/api/resource/Shift%20Location/${assignment.shift_location}`,
                { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
            );
            const locData = await locResponse.json();
            
            if (locData.data) {
                location = {
                    name: locData.data.location_name || locData.data.name,
                    latitude: locData.data.latitude,
                    longitude: locData.data.longitude,
                    radius: locData.data.checkin_radius || 100
                };
                console.log(`  Location: ${location.name} (${location.latitude}, ${location.longitude})`);
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

// ============================================
// CHECK-IN ENDPOINTS (No Cache - Real-time)
// ============================================

// Create check-in
app.post('/api/checkin', async (req, res) => {
    const { employeeId, logType, timestamp, latitude, longitude } = req.body;
    
    console.log('📝 Check-in request:', { employeeId, logType, timestamp, latitude, longitude });
    
    if (!employeeId || !logType || !timestamp) {
        console.log('❌ Missing required fields');
        return res.status(400).json({ error: 'Missing required fields', details: 'employeeId, logType, and timestamp are required' });
    }
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        const payload = {
            employee: employeeId,
            log_type: logType,
            time: timestamp
        };
        
        // Include latitude/longitude if provided
        if (latitude !== undefined && longitude !== undefined) {
            payload.latitude = latitude;
            payload.longitude = longitude;
        }
        
        console.log('📤 Sending to ERPNext:', JSON.stringify(payload));
        
        const response = await fetch(
            `${ERP_URL}/api/resource/Employee%20Checkin`,
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
            // Clear the today-checkins cache for this employee
            const today = new Date().toISOString().split('T')[0];
            const cacheKey = `${ERP_URL}/api/resource/Employee%20Checkin?filters=[["employee","=","${employeeId}"],["time","like","${today}%"]]&order_by=time%20asc`;
            delete cache[cacheKey];
            console.log('🗑️ Cleared check-in cache for:', employeeId);
            
            res.json({ success: true, data: result.data });
        } else {
            console.log('❌ ERPNext rejected:', result);
            res.status(400).json({ 
                error: result.message || result._server_messages || 'Check-in failed',
                details: result
            });
        }
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({ error: 'Server error during check-in' });
    }
});

// ============================================
// LEAVE ENDPOINTS
// ============================================

app.get('/api/leave-balance/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    
    console.log(`🔍 Fetching leave balance for employee: ${employeeId}`);
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Allocation?filters=[["employee","=","${employeeId}"],["docstatus","=",1]]&fields=["*"]`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        
        const data = await response.json();
        console.log(`📊 Leave Allocation response:`, data.data?.length || 0, 'records found');
        
        const balances = (data.data || []).map(alloc => ({
            leave_type: alloc.leave_type,
            leaves_allocated: alloc.new_leaves_allocated || alloc.total_leaves_allocated || 0,
            leaves_taken: 0
        }));
        
        res.json({ success: true, balances });
    } catch (error) {
        console.error('Leave balance error:', error.message);
        res.status(500).json({ error: 'Server error fetching leave balance' });
    }
});

app.get('/api/leave-requests/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Application?filters=[["employee","=","${employeeId}"]]&fields=["leave_type","from_date","to_date","status","total_leave_days"]&order_by=creation%20desc&limit=10`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const data = await response.json();
        res.json({ success: true, requests: data.data || [] });
    } catch (error) {
        console.error('Leave requests error:', error);
        res.status(500).json({ error: 'Server error fetching leave requests' });
    }
});

app.post('/api/leave-application', async (req, res) => {
    const { employeeId, leaveType, fromDate, toDate, halfDay, halfDayDate, reason } = req.body;
    
    console.log('📝 Leave application received:', { employeeId, leaveType, fromDate, toDate });
    
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
        
        // POST request - no cache
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
            res.status(400).json({ error: result.message || result.exc || 'Failed to submit leave application' });
        }
    } catch (error) {
        console.error('Leave application error:', error);
        res.status(500).json({ error: 'Server error submitting leave application' });
    }
});

// ============================================
// APPROVAL ENDPOINTS
// ============================================

app.get('/api/approvals/:email', async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        const approvals = [];
        
        // Get employee record for this user
        const empResponse = await cachedGet(
            `${ERP_URL}/api/resource/Employee?filters=[["user_id","=","${email}"]]&fields=["name","employee_name"]&limit=1`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const empData = await empResponse.json();
        
        if (!empData.data || empData.data.length === 0) {
            return res.json({ success: true, approvals: [] });
        }
        
        const employee = empData.data[0];
        const employeeName = employee.employee_name;
        
        // METHOD 1: Leave Applications pending approval (no workflow needed)
        const leaveAppResponse = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Application?filters=[["status","=","Open"]]&fields=["name","employee","employee_name","leave_type","from_date","to_date","total_leave_days","creation","leave_approver"]&limit=20`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const leaveAppData = await leaveAppResponse.json();
        
        // Get user roles
        const userResponse = await cachedGet(
            `${ERP_URL}/api/resource/User/${email}`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const userData = await userResponse.json();
        const userRoles = (userData.data?.roles || []).map(r => r.role);
        
        for (const app of (leaveAppData.data || [])) {
            const approverEmpResponse = await cachedGet(
                `${ERP_URL}/api/resource/Employee/${app.employee}`,
                { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
            );
            const approverData = await approverEmpResponse.json();
            
            const leaveApprover = approverData.data?.leave_approver;
            const isApprover = (leaveApprover === employeeName || leaveApprover === email);
            const isHRManager = userRoles.includes('HR Manager') || userRoles.includes('HR User');
            
            if (isApprover || isHRManager) {
                approvals.push({
                    doctype: 'Leave Application',
                    docname: app.name,
                    title: `${app.employee_name} - ${app.leave_type}`,
                    subtitle: `${app.from_date} to ${app.to_date} (${app.total_leave_days} days)`,
                    state: 'Open',
                    next_action: 'Approve',
                    employee: app.employee_name,
                    detail: `${app.leave_type}: ${app.from_date} to ${app.to_date}`
                });
            }
        }
        
        // METHOD 2: Workflow-based approvals (if workflows exist)
        try {
            const wfResponse = await cachedGet(
                `${ERP_URL}/api/resource/Workflow%20Action?fields=["*"]&limit=50`,
                { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
            );
            const wfData = await wfResponse.json();
            
            for (const action of (wfData.data || [])) {
                if (!userRoles.includes(action.permitted_role)) continue;
                
                try {
                    const docResponse = await cachedGet(
                        `${ERP_URL}/api/resource/${action.reference_doctype}?filters=[["workflow_state","=","${action.status}"]]&fields=["name","title","workflow_state","owner","modified"]&limit=20`,
                        { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
                    );
                    const docData = await docResponse.json();
                    
                    for (const doc of (docData.data || [])) {
                        const alreadyAdded = approvals.some(a => a.docname === doc.name && a.doctype === action.reference_doctype);
                        if (!alreadyAdded) {
                            approvals.push({
                                doctype: action.reference_doctype,
                                docname: doc.name,
                                title: doc.title || doc.name,
                                subtitle: action.reference_doctype,
                                state: doc.workflow_state,
                                next_action: action.action,
                                owner: doc.owner
                            });
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        } catch (e) {
            console.log('No workflows configured - using default approval only');
        }
        
        res.json({ success: true, approvals });
    } catch (error) {
        console.error('Approvals error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get print format HTML for any document
app.get('/api/print-format/:doctype/:docname', async (req, res) => {
    const { doctype, docname } = req.params;
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        // Try the printview endpoint with letterhead
        const response = await cachedGet(
            `${ERP_URL}/api/method/frappe.www.printview.get_html_and_style?doc=${docname}&doctype=${doctype}&print_format=Standard&no_letterhead=1`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const result = await response.json();
        
        if (result.message?.html) {
            res.json({ success: true, html: result.message.html });
        } else {
            // Fallback: Return a simple document summary
            const docResponse = await cachedGet(
                `${ERP_URL}/api/resource/${doctype}/${docname}?fields=["*"]`,
                { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
            );
            const docData = await docResponse.json();
            
            if (docData.data) {
                const doc = docData.data;
                let html = '<div style="padding: 16px; font-family: sans-serif;">';
                html += `<h3>${doctype}: ${docname}</h3>`;
                html += '<table style="width:100%; border-collapse:collapse;">';
                
                for (const [key, value] of Object.entries(doc)) {
                    if (key.startsWith('_') || value === null || value === '') continue;
                    html += `<tr><td style="padding:8px; border-bottom:1px solid #eee; font-weight:bold;">${key}</td><td style="padding:8px; border-bottom:1px solid #eee;">${value}</td></tr>`;
                }
                
                html += '</table></div>';
                res.json({ success: true, html });
            } else {
                res.json({ success: true, html: '<p>Document not found</p>' });
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// DEBUG ENDPOINTS
// ============================================

app.get('/api/debug/leave-allocation/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Allocation?filters=[["employee","=","${employeeId}"]]&fields=["*"]&limit=10`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const data = await response.json();
        
        res.json({ 
            count: data.data?.length || 0,
            allocations: data.data || [],
            employeeId: employeeId
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug/leave-by-name/:docName', async (req, res) => {
    const docName = req.params.docName;
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Allocation/${docName}`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug/all-leave-allocations', async (req, res) => {
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Allocation?fields=["*"]&limit=20`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const data = await response.json();
        res.json({ 
            count: data.data?.length || 0,
            allocations: data.data || []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get upcoming schedule for an employee (next 30 days)
app.get('/api/schedule/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    const today = new Date().toISOString().split('T')[0];
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const endDate = futureDate.toISOString().split('T')[0];
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        // Fetch shift assignments
        const shiftResponse = await cachedGet(
            `${ERP_URL}/api/resource/Shift%20Assignment?filters=[["employee","=","${employeeId}"],["start_date","<=","${endDate}"],["end_date",">=","${today}"]]&fields=["shift_type","start_date","end_date","shift_location"]&limit=30`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const shiftData = await shiftResponse.json();
        
        // Fetch approved leave applications
        const leaveResponse = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Application?filters=[["employee","=","${employeeId}"],["status","=","Approved"],["from_date","<=","${endDate}"],["to_date",">=","${today}"]]&fields=["leave_type","from_date","to_date"]&limit=10`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const leaveData = await leaveResponse.json();
        
        // Fetch holidays
        const holidayResponse = await cachedGet(
            `${ERP_URL}/api/resource/Holiday?filters=[["holiday_date",">=","${today}"],["holiday_date","<=","${endDate}"]]&fields=["description","holiday_date"]&limit=30`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const holidayData = await holidayResponse.json();
        
        res.json({
            success: true,
            shifts: shiftData.data || [],
            leaves: leaveData.data || [],
            holidays: holidayData.data || [],
            period: { from: today, to: endDate }
        });
    } catch (error) {
        console.error('Schedule error:', error);
        res.status(500).json({ error: 'Server error fetching schedule' });
    }
});

// Get payslips for an employee
app.get('/api/payslips/:employeeId', async (req, res) => {
    const employeeId = req.params.employeeId;
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured on server' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Salary%20Slip?filters=[["employee","=","${employeeId}"],["docstatus","=",1]]&fields=["name","start_date","end_date","gross_pay","net_pay","total_deduction","status","posting_date"]&order_by=posting_date%20desc&limit=12`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const data = await response.json();
        
        const payslips = (data.data || []).map(slip => ({
            name: slip.name,
            start_date: slip.start_date,
            end_date: slip.end_date,
            gross_pay: slip.gross_pay,
            net_pay: slip.net_pay,
            total_deduction: slip.total_deduction,
            status: slip.status || 'Paid',
            posting_date: slip.posting_date,
            period: slip.start_date ? 
                new Date(slip.start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 
                'N/A'
        }));
        
        res.json({ success: true, payslips });
    } catch (error) {
        console.error('Payslips error:', error);
        res.status(500).json({ error: 'Server error fetching payslips' });
    }
});

// Get payslip print format
app.get('/api/payslip-print/:payslipName', async (req, res) => {
    const payslipName = req.params.payslipName;
    
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/method/frappe.www.printview.get_html_and_style?doc=${payslipName}&doctype=Salary%20Slip&print_format=Salary%20Slip%20Standard`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const result = await response.json();
        
        res.json({ 
            success: true, 
            html: result.message?.html || 'No print format available'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DEBUG: Check all leave applications
app.get('/api/debug/leave-applications', async (req, res) => {
    if (!API_KEY || !API_SECRET) {
        return res.status(500).json({ error: 'API keys not configured' });
    }
    
    try {
        const response = await cachedGet(
            `${ERP_URL}/api/resource/Leave%20Application?fields=["*"]&limit=20`,
            { 'Authorization': `token ${API_KEY}:${API_SECRET}` }
        );
        const data = await response.json();
        
        res.json({ 
            count: data.data?.length || 0,
            applications: (data.data || []).map(app => ({
                name: app.name,
                employee: app.employee,
                employee_name: app.employee_name,
                leave_type: app.leave_type,
                status: app.status,
                from_date: app.from_date,
                to_date: app.to_date,
                leave_approver: app.leave_approver
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
    console.log(`404 - Route not found: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Route not found' });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 ERP_URL: ${ERP_URL}`);
    console.log(`🔑 API_KEY configured: ${API_KEY ? 'YES' : 'NO'}`);
});
