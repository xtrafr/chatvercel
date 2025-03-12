const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
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
    destination: './public/uploads/',
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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected');
    let currentUser = null;

    socket.on('login', (data) => {
        const { username } = data;
        currentUser = username;
        
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
        const newMessage = {
            id: uuidv4(),
            ...message
        };
        
        messages.push(newMessage);
        if (messages.length > 200) messages.shift(); // Keep only last 200 messages
        
        io.emit('chatMessage', newMessage);
    });

    socket.on('typing', (username) => {
        socket.broadcast.emit('userTyping', username);
    });

    socket.on('stopTyping', () => {
        // Handle stop typing event if needed
    });

    socket.on('clearChat', () => {
        const user = Array.from(users.values()).find(u => u.username === currentUser);
        if (user && user.isAdmin) {
            messages.length = 0;
            io.emit('chatCleared');
        }
    });

    socket.on('banUser', (username) => {
        const user = Array.from(users.values()).find(u => u.username === currentUser);
        if (user && user.isAdmin) {
            const bannedUser = Array.from(users.values()).find(u => u.username === username);
            if (bannedUser) {
                users.delete(username);
                io.emit('userLeft', {
                    username,
                    users: Array.from(users.values()).map(u => ({
                        username: u.username,
                        isAdmin: u.isAdmin,
                        online: true
                    }))
                });
                io.emit('error', `User ${username} has been banned`);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        if (currentUser) {
            // Find and remove user
            for (const [username, user] of users.entries()) {
                if (user.username === currentUser) {
                    users.delete(username);
                    break;
                }
            }
            
            // Notify others that user has left
            socket.broadcast.emit('userLeft', {
                username: currentUser,
                users: Array.from(users.values()).map(u => ({
                    username: u.username,
                    isAdmin: u.isAdmin,
                    online: true
                }))
            });
        }
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
        isAdmin: u.isAdmin
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
    for (const [username, user] of users.entries()) {
        if (user.userId === userId) {
            users.delete(username);
            break;
        }
    }
    
    res.json({ success: true });
});

app.get('/api/users', (req, res) => {
    const onlineUsers = Array.from(users.values()).map(user => ({
        username: user.username,
        isAdmin: user.isAdmin
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
    
    res.json({ success: true, message: newMessage });
});

app.post('/api/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message });
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
    res.json({ success: true });
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const fs = require('fs');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Start server
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
