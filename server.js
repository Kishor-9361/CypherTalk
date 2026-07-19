const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const JWT_SECRET = 'encrypted-video-call-secure-secret-key-2026';
const DB_FILE = path.join(__dirname, 'data.json');

const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    auth: { user: 'example@ethereal.email', pass: 'your-pass' }
});

const otpStore = new Map();

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], calls: [], nextId: 1, nextCallId: 1 }));
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    // Ensure structure
    data.users.forEach(u => { 
        if (!u.contacts) u.contacts = []; 
        if (!u.userId) u.userId = 'u_' + Math.random().toString(36).substr(2, 6);
        if (!u.displayName) u.displayName = u.email;
    });
    return data;
}

function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Authentication Middleware
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
        next();
    } catch { res.status(401).json({ error: 'Unauthorized' }); }
}

// --- AUTH & OTP ---
app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    console.log(`[DEV ONLY] OTP for ${email}: ${code}`);
    res.json({ success: true });
});

app.post('/api/register', (req, res) => {
    const { email, password, code, displayName } = req.body;
    const otp = otpStore.get(email);
    if (!otp || otp.code !== code || Date.now() > otp.expiresAt) return res.status(400).json({ error: 'Invalid OTP' });

    const db = readDB();
    if (db.users.find(u => u.email === email)) return res.status(409).json({ error: 'Email exists' });

    const user = { 
        id: db.nextId++, 
        userId: 'u_' + Math.random().toString(36).substr(2, 6), 
        email, 
        displayName: displayName || email,
        password: bcrypt.hashSync(password, 10), 
        contacts: [] 
    };
    db.users.push(user);
    writeDB(db);
    res.status(201).json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email === email);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid' });

    const token = jwt.sign({ userId: user.userId, email: user.email, displayName: user.displayName }, JWT_SECRET);
    res.json({ token, userId: user.userId, displayName: user.displayName });
});

// --- PROFILE ---
app.get('/api/profile', authMiddleware, (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.userId === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ userId: user.userId, email: user.email, displayName: user.displayName });
});

// --- CONTACTS ---
app.get('/api/contacts', authMiddleware, (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.userId === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const contactsWithStatus = (user.contacts || []).map(c => {
        return {
            userId: c.userId,
            displayName: c.displayName,
            online: onlineUsers.has(c.userId)
        };
    });
    res.json(contactsWithStatus);
});

app.post('/api/add-friend', authMiddleware, (req, res) => {
    const { targetUserId } = req.body;
    const db = readDB();
    const me = db.users.find(u => u.userId === req.user.userId);
    const friend = db.users.find(u => u.userId === targetUserId);
    
    if (!friend) return res.status(404).json({ error: 'User not found' });
    if (me.userId === targetUserId) return res.status(400).json({ error: 'Cannot add yourself' });
    if (me.contacts.find(c => c.userId === targetUserId)) return res.status(409).json({ error: 'Already friend' });
    
    me.contacts.push({ userId: friend.userId, displayName: friend.displayName });
    writeDB(db);
    res.json({ success: true, contact: { userId: friend.userId, displayName: friend.displayName, online: onlineUsers.has(friend.userId) } });
});

// --- SIGNALING ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
    catch { next(new Error('Unauthorized')); }
});

const onlineUsers = new Map(); 

io.on('connection', (socket) => {
    onlineUsers.set(socket.user.userId, { socketId: socket.id });
    
    // Broadcast status change when a user connects
    socket.broadcast.emit('user-status-change', { userId: socket.user.userId, online: true });
    
    socket.on('call-user', ({ toUserId, offer }) => {
        const target = onlineUsers.get(toUserId);
        if (target) io.to(target.socketId).emit('incoming-call', { fromUserId: socket.user.userId, offer });
    });

    socket.on('accept-call', ({ toUserId, answer }) => {
        const target = onlineUsers.get(toUserId);
        if (target) io.to(target.socketId).emit('call-accepted', { fromUserId: socket.user.userId, answer });
    });
    
    socket.on('ice-candidate', ({ toUserId, candidate }) => {
        const target = onlineUsers.get(toUserId);
        if (target) io.to(target.socketId).emit('ice-candidate', { fromUserId: socket.user.userId, candidate });
    });
    
    socket.on('end-call', ({ toUserId }) => {
        const target = onlineUsers.get(toUserId);
        if (target) io.to(target.socketId).emit('call-ended', { fromUserId: socket.user.userId });
    });
    
    socket.on('reject-call', ({ toUserId }) => {
        const target = onlineUsers.get(toUserId);
        if (target) io.to(target.socketId).emit('call-rejected', { fromUserId: socket.user.userId });
    });
    
    socket.on('disconnect', () => {
        onlineUsers.delete(socket.user.userId);
        socket.broadcast.emit('user-status-change', { userId: socket.user.userId, online: false });
    });
});

server.listen(3000, () => console.log('Running on http://localhost:3000'));
