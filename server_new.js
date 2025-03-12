const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// In-memory storage
const users = new Map();
const messages = [];
const typingUsers = new Map(); // Store typing status with timestamp
const ADMIN_USERNAME = 'admin';

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads/';
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
}).array('files', 5);

// Helper function to get online users
const getOnlineUsers = () => {
    const now = Date.now();
    return Array.from(users.values())
        .filter(user => now - user.lastActive < 10000)
        .map(user => ({
            username: user.username,
            isAdmin: user.isAdmin,
            online: true
        }));
};

// Routes
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    
    if (!username || username.trim() === '') {
        return res.status(400).json({ success: false, error: 'Username is required' });
    }

    const cleanUsername = username.trim();
    const userId = uuidv4();

    if (Array.from(users.values()).some(u => u.username === cleanUsername)) {
        return res.status(400).json({ success: false, error: 'Username already taken' });
    }

    const isAdmin = cleanUsername === ADMIN_USERNAME;
    const user = {
        userId,
        username: cleanUsername,
        isAdmin,
        lastActive: Date.now()
    };
    users.set(userId, user);

    const joinMessage = {
        id: uuidv4(),
        type: 'system',
        content: `${cleanUsername} joined the chat`,
        timestamp: new Date().toISOString()
    };
    messages.push(joinMessage);

    res.json({
        success: true,
        userId,
        isAdmin,
        messages: messages.slice(-50),
        onlineUsers: getOnlineUsers()
    });
});

app.post('/api/logout', (req, res) => {
    const { userId } = req.body;
    
    if (!userId || !users.has(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const user = users.get(userId);
    
    const leaveMessage = {
        id: uuidv4(),
        type: 'system',
        content: `${user.username} left the chat`,
        timestamp: new Date().toISOString()
    };
    messages.push(leaveMessage);

    users.delete(userId);
    typingUsers.delete(userId);

    res.json({ success: true });
});

app.get('/api/messages', (req, res) => {
    const { userId, lastId } = req.query;
    
    if (!userId || !users.has(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const user = users.get(userId);
    user.lastActive = Date.now();
    
    const lastIndex = lastId ? messages.findIndex(m => m.id === lastId) : -1;
    const newMessages = lastIndex >= 0 ? messages.slice(lastIndex + 1) : messages.slice(-50);

    const now = Date.now();
    const typing = Array.from(typingUsers.entries())
        .filter(([id, data]) => {
            if (now - data.timestamp > 3000) {
                typingUsers.delete(id);
                return false;
            }
            return id !== userId && data.isTyping;
        })
        .map(([id]) => users.get(id)?.username)
        .filter(Boolean);

    res.json({
        success: true,
        messages: newMessages,
        typing,
        users: getOnlineUsers()
    });
});

app.post('/api/send-message', (req, res) => {
    const { userId, content, type = 'text', replyTo, replyToUsername, replyToContent } = req.body;
    
    if (!userId || !users.has(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    if (!content) {
        return res.status(400).json({ success: false, error: 'Message content is required' });
    }

    const user = users.get(userId);
    user.lastActive = Date.now();

    const message = {
        id: uuidv4(),
        username: user.username,
        content,
        type,
        timestamp: new Date().toISOString()
    };

    if (replyTo) {
        message.replyTo = replyTo;
        message.replyToUsername = replyToUsername;
        message.replyToContent = replyToContent;
    }

    messages.push(message);
    if (messages.length > 200) messages.shift();

    res.json({ success: true });
});

app.post('/api/typing', (req, res) => {
    const { userId, isTyping } = req.body;
    
    if (!userId || !users.has(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const user = users.get(userId);
    user.lastActive = Date.now();

    typingUsers.set(userId, {
        isTyping,
        timestamp: Date.now()
    });

    res.json({ success: true });
});

app.post('/api/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
        
        if (!req.files || !req.files.length) {
            return res.status(400).json({ success: false, error: 'No files uploaded' });
        }

        const urls = req.files.map(file => `/uploads/${file.filename}`);
        res.json({ success: true, urls });
    });
});

app.post('/api/admin/clear-chat', (req, res) => {
    const { userId } = req.body;
    
    if (!userId || !users.has(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const user = users.get(userId);
    if (!user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    messages.length = 0;
    messages.push({
        id: uuidv4(),
        type: 'system',
        content: 'Chat cleared by admin',
        timestamp: new Date().toISOString()
    });

    res.json({ success: true });
});

app.post('/api/admin/ban-user', (req, res) => {
    const { userId, username } = req.body;
    
    if (!userId || !users.has(userId)) {
        return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const admin = users.get(userId);
    if (!admin.isAdmin) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    const targetUser = Array.from(users.values()).find(u => u.username === username);
    if (!targetUser) {
        return res.status(400).json({ success: false, error: 'User not found' });
    }

    users.delete(targetUser.userId);
    typingUsers.delete(targetUser.userId);

    messages.push({
        id: uuidv4(),
        type: 'system',
        content: `${username} has been banned by admin`,
        timestamp: new Date().toISOString()
    });

    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
