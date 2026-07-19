const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Load environment variables from .env if it exists
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
    const envConfig = fs.readFileSync(ENV_FILE, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valParts] = trimmed.split('=');
            if (key && valParts.length) {
                process.env[key.trim()] = valParts.join('=').trim();
            }
        }
    });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const JWT_SECRET = process.env.JWT_SECRET || 'encrypted-video-call-secure-secret-key-2026';
const DB_FILE = path.join(__dirname, 'data.json');

// --- FIREBASE TOKEN VERIFICATION ---
const https = require('https');
let googleCerts = {};
let certsExpiry = 0;

async function getGoogleCerts() {
    if (Date.now() < certsExpiry && Object.keys(googleCerts).length > 0) {
        return googleCerts;
    }
    return new Promise((resolve, reject) => {
        https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    googleCerts = JSON.parse(data);
                    const cacheControl = res.headers['cache-control'];
                    let maxAge = 3600;
                    if (cacheControl) {
                        const match = cacheControl.match(/max-age=(\d+)/);
                        if (match) maxAge = parseInt(match[1]);
                    }
                    certsExpiry = Date.now() + (maxAge * 1000);
                    resolve(googleCerts);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function verifyFirebaseToken(token) {
    const decodedHeader = jwt.decode(token, { complete: true });
    if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
        throw new Error('Invalid token format');
    }
    const certs = await getGoogleCerts();
    const cert = certs[decodedHeader.header.kid];
    if (!cert) {
        throw new Error('Public key cert not found for kid: ' + decodedHeader.header.kid);
    }
    const projectId = process.env.FIREBASE_PROJECT_ID || 'cyphertalk-195d6';
    return jwt.verify(token, cert, {
        audience: projectId,
        issuer: `https://securetoken.google.com/${projectId}`,
        algorithms: ['RS256']
    });
}

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

app.get('/api/ping', (req, res) => {
    res.json({ status: "alive" });
});

app.get('/api/firebase-config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        measurementId: process.env.FIREBASE_MEASUREMENT_ID
    });
});

// Firebase Authentication Middleware
async function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = header.split(' ')[1];
    try {
        const decoded = await verifyFirebaseToken(token);
        req.user = { userId: decoded.sub, email: decoded.email };
        next();
    } catch (err) {
        console.error("Auth verification failed:", err.message);
        res.status(401).json({ error: 'Unauthorized' });
    }
}

app.post('/api/register', async (req, res) => {
    const { idToken, displayName } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Missing ID Token' });
    
    try {
        const decoded = await verifyFirebaseToken(idToken);
        const email = decoded.email;
        const uid = decoded.sub;
        
        const db = readDB();
        let user = db.users.find(u => u.userId === uid);
        
        if (!user) {
            user = {
                id: db.nextId++,
                userId: uid,
                email: email,
                displayName: displayName || email.split('@')[0],
                contacts: []
            };
            db.users.push(user);
            writeDB(db);
            res.status(201).json({ success: true, isNew: true });
        } else {
            if (displayName && user.displayName !== displayName) {
                user.displayName = displayName;
                writeDB(db);
            }
            res.json({ success: true, isNew: false });
        }
    } catch (err) {
        console.error("Registration error:", err.message);
        res.status(400).json({ error: 'Invalid ID Token' });
    }
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
io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
        const decoded = await verifyFirebaseToken(token);
        socket.user = { userId: decoded.sub, email: decoded.email };
        next();
    }
    catch (err) {
        console.error("Socket authentication failed:", err.message);
        next(new Error('Unauthorized'));
    }
});

const onlineUsers = new Map(); 

io.on('connection', (socket) => {
    onlineUsers.set(socket.user.userId, { socketId: socket.id });
    
    // Broadcast status change when a user connects
    socket.broadcast.emit('user-status-change', { userId: socket.user.userId, online: true });
    
    socket.on('call-user', ({ toUserId, offer }) => {
        const target = onlineUsers.get(toUserId);
        if (target) {
            io.to(target.socketId).emit('incoming-call', { fromUserId: socket.user.userId, offer });
        } else {
            socket.emit('call-rejected', { fromUserId: toUserId, reason: 'offline' });
        }
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
