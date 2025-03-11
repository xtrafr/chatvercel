const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory storage
const users = new Map();
const messages = [];
const replies = new Map();
const bannedIPs = new Set();

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = './public/uploads';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error('Invalid file type'));
    }
});

// API Routes
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    const isAdmin = username.toLowerCase() === 'admin';

    if (!username) {
        return res.status(400).json({ success: false, error: 'Username is required' });
    }

    // Send message history with login response
    res.json({ 
        success: true, 
        isAdmin,
        messages: messages.slice(-50) // Send last 50 messages
    });
});

app.post('/api/upload', upload.array('files', 5), (req, res) => {
    try {
        const urls = req.files.map(file => `/uploads/${file.filename}`);
        res.json({ success: true, urls });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Socket.IO event handlers
io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('login', ({ username }) => {
        const userIP = socket.handshake.address;
        
        if (bannedIPs.has(userIP)) {
            socket.emit('error', 'You have been banned from the chat');
            socket.disconnect();
            return;
        }

        const isAdmin = username.toLowerCase() === 'admin';
        
        currentUser = {
            id: socket.id,
            username,
            isAdmin,
            online: true
        };

        users.set(socket.id, currentUser);
        
        io.emit('userJoined', {
            username,
            users: Array.from(users.values())
        });
    });

    socket.on('chatMessage', (message) => {
        if (!currentUser) return;

        const messageId = uuidv4();
        const enhancedMessage = {
            ...message,
            id: messageId,
            type: message.type || 'text',
            replyTo: message.replyTo || null
        };

        messages.push(enhancedMessage);

        // If this is a reply, store it in replies map
        if (message.replyTo) {
            if (!replies.has(message.replyTo)) {
                replies.set(message.replyTo, []);
            }
            replies.get(message.replyTo).push(messageId);
        }

        io.emit('chatMessage', enhancedMessage);
    });

    socket.on('getReplies', (messageId) => {
        const messageReplies = replies.get(messageId) || [];
        const replyMessages = messageReplies.map(replyId => 
            messages.find(m => m.id === replyId)
        ).filter(Boolean);
        
        socket.emit('messageReplies', {
            messageId,
            replies: replyMessages
        });
    });

    socket.on('typing', (username) => {
        socket.broadcast.emit('userTyping', username);
    });

    socket.on('stopTyping', (username) => {
        socket.broadcast.emit('userStoppedTyping', username);
    });

    // Admin events
    socket.on('clearChat', () => {
        if (currentUser?.isAdmin) {
            messages.length = 0;
            replies.clear();
            io.emit('chatCleared');
        }
    });

    socket.on('banUser', (username) => {
        if (currentUser?.isAdmin) {
            const userToBan = Array.from(users.values()).find(u => u.username === username);
            if (userToBan) {
                const socketToBan = io.sockets.sockets.get(userToBan.id);
                if (socketToBan) {
                    bannedIPs.add(socketToBan.handshake.address);
                    socketToBan.emit('error', 'You have been banned from the chat');
                    socketToBan.disconnect();
                }
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentUser) {
            users.delete(socket.id);
            io.emit('userLeft', {
                username: currentUser.username,
                users: Array.from(users.values())
            });
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ success: false, error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
