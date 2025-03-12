const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Configure Socket.io for Vercel environment
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 10000,
    pingInterval: 2500,
    transports: ['websocket', 'polling'],
    path: '/socket.io/',
    // These settings help with Vercel's serverless functions
    allowEIO3: true,
    cookie: false
});

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// In-memory storage
const users = new Map();
const messages = [];
const ADMIN_USERNAME = 'admin';

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads/';
        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5000000 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);
        if (extname && mimetype) {
            return cb(null, true);
        } else {
            cb('Error: Invalid file type!');
        }
    }
}).array('files', 5); // Allow up to 5 files

// Socket connection map to track users and their socket IDs
const userSockets = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    let currentUser = null;

    socket.on('login', (data) => {
        const { username } = data;
        currentUser = username;
        
        // Store socket ID for this user
        userSockets.set(username, socket.id);
        
        console.log(`User ${username} logged in with socket ${socket.id}`);
        
        // Notify others that user has joined
        socket.broadcast.emit('userJoined', {
            username,
            users: Array.from(users.values()).map(u => ({
                username: u.username,
                isAdmin: u.isAdmin,
                online: true
            }))
        });
    });

    socket.on('chatMessage', (message) => {
        if (!currentUser) return;
        
        const newMessage = {
            id: uuidv4(),
            ...message
        };
        
        messages.push(newMessage);
        if (messages.length > 200) messages.shift(); // Keep only last 200 messages
        
        io.emit('chatMessage', newMessage);
    });

    socket.on('typing', (username) => {
        if (!currentUser) return;
        socket.broadcast.emit('userTyping', username);
    });

    socket.on('stopTyping', () => {
        // Handle stop typing event if needed
    });

    socket.on('clearChat', () => {
        if (!currentUser) return;
        
        const user = Array.from(users.values()).find(u => u.username === currentUser);
        if (user && user.isAdmin) {
            messages.length = 0;
            io.emit('chatCleared');
        }
    });

    socket.on('banUser', (username) => {
        if (!currentUser) return;
        
        const user = Array.from(users.values()).find(u => u.username === currentUser);
        if (user && user.isAdmin) {
            const bannedUser = Array.from(users.values()).find(u => u.username === username);
            if (bannedUser) {
                users.delete(username);
                
                // Disconnect the banned user's socket
                const bannedSocketId = userSockets.get(username);
                if (bannedSocketId) {
                    const bannedSocket = io.sockets.sockets.get(bannedSocketId);
                    if (bannedSocket) {
                        bannedSocket.emit('error', `You have been banned by admin`);
                        bannedSocket.disconnect(true);
                    }
                    userSockets.delete(username);
                }
                
                io.emit('userLeft', {
                    username,
                    users: Array.from(users.values()).map(u => ({
                        username: u.username,
                        isAdmin: u.isAdmin,
                        online: true
                    }))
                });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        if (currentUser) {
            // Find and remove user from socket map
            userSockets.delete(currentUser);
            
            // Don't remove from users map on disconnect - only on explicit logout
            // This allows users to reconnect without losing their session
            
            // Notify others that user has left
            socket.broadcast.emit('userLeft', {
                username: currentUser,
                users: Array.from(users.values()).map(u => ({
                    username: u.username,
                    isAdmin: u.isAdmin,
                    online: userSockets.has(u.username)
                }))
            });
        }
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Routes
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    
    if (!username || username.trim() === '') {
        return res.status(400).json({ success: false, error: 'Username is required' });
    }

    const cleanUsername = username.trim();
    const userId = uuidv4();

    // Check if username is taken
    if (users.has(cleanUsername)) {
        return res.status(400).json({ success: false, error: 'Username already taken' });
    }

    const isAdmin = cleanUsername.toLowerCase() === ADMIN_USERNAME;
    const user = {
        userId,
        username: cleanUsername,
        isAdmin
    };

    users.set(cleanUsername, user);
    
    // Get list of online users
    const onlineUsers = Array.from(users.values()).map(u => ({
        username: u.username,
        isAdmin: u.isAdmin,
        online: userSockets.has(u.username)
    }));

    res.json({
        success: true,
        userId,
        isAdmin,
        messages: messages.slice(-50), // Send last 50 messages
        onlineUsers // Send list of online users
    });
});

app.post('/api/logout', (req, res) => {
    const { userId } = req.body;
    
    // Find and remove user
    let username = null;
    for (const [uname, user] of users.entries()) {
        if (user.userId === userId) {
            username = uname;
            users.delete(uname);
            break;
        }
    }
    
    // Also remove from socket map if found
    if (username && userSockets.has(username)) {
        const socketId = userSockets.get(username);
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
            socket.disconnect(true);
        }
        userSockets.delete(username);
    }
    
    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    const onlineUsers = Array.from(users.values()).map(user => ({
        username: user.username,
        isAdmin: user.isAdmin,
        online: userSockets.has(user.username)
    }));
    
    res.json({ success: true, users: onlineUsers });
});

app.post('/api/send-message', (req, res) => {
    const { userId, message } = req.body;
    
    // Find user by userId
    let user = null;
    for (const u of users.values()) {
        if (u.userId === userId) {
            user = u;
            break;
        }
    }
    
    if (!user) {
        return res.status(401).json({ success: false, error: 'User not found' });
    }
    
    const newMessage = {
        id: uuidv4(),
        userId,
        username: user.username,
        content: message,
        timestamp: new Date(),
        isAdmin: user.isAdmin
    };
    
    messages.push(newMessage);
    if (messages.length > 200) messages.shift(); // Keep only last 200 messages
    
    // Broadcast to all connected clients
    io.emit('chatMessage', newMessage);
    
    res.json({ success: true, message: newMessage });
});

app.post('/api/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message || err });
        }
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
        }
        
        const fileUrls = req.files.map(file => `/uploads/${file.filename}`);
        res.json({ success: true, urls: fileUrls });
    });
});

// Admin routes
app.post('/api/admin/clear-chat', (req, res) => {
    const { userId } = req.body;
    
    // Find user by userId
    let user = null;
    for (const u of users.values()) {
        if (u.userId === userId) {
            user = u;
            break;
        }
    }
    
    if (!user || !user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
    }
    
    messages.length = 0;
    
    // Notify all clients
    io.emit('chatCleared');
    
    res.json({ success: true });
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        users: users.size,
        connections: userSockets.size
    });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    server.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
} else {
    // For Vercel production
    // Export the Express API
    module.exports = app;
}
