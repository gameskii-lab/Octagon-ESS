const express = require('express');
const app = express();

// Simple request logger
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// CORS - Allow your frontend
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://octagon-ess.onrender.com');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Parse JSON
app.use(express.json());

// Routes
app.get('/', (req, res) => {
    res.json({ message: 'Middleware is working!' });
});

app.get('/ping', (req, res) => {
    res.json({ pong: true });
});

app.post('/api/login', (req, res) => {
    console.log('Login attempt:', req.body);
    res.json({ success: true, test: true });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
