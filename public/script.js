class ChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = null;
        this.isAdmin = false;
        this.typingTimeout = null;
        this.replyingTo = null;
        this.setupDOMElements();
        this.initializeEventListeners();
        this.checkSession();
    }

    setupDOMElements() {
        // Login elements
        this.loginContainer = document.getElementById('login-container');
        this.chatContainer = document.getElementById('chat-container');
        this.usernameInput = document.getElementById('username-input');
        this.loginBtn = document.getElementById('login-btn');

        // Chat elements
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.chatMessages = document.getElementById('chat-messages');
        this.usersList = document.getElementById('users-list');
        this.fileInput = document.getElementById('file-input');
        this.typingIndicator = document.querySelector('.typing-indicator');
        this.adminPanel = document.getElementById('admin-panel');
        this.replyingToDiv = document.getElementById('replying-to');
        this.replyText = this.replyingToDiv.querySelector('.reply-text');
        this.cancelReplyBtn = this.replyingToDiv.querySelector('.cancel-reply');
        this.logoutBtn = document.getElementById('logout-btn');
        this.notifications = document.getElementById('notifications');

        // Ensure chat container is hidden initially
        this.chatContainer.classList.add('hidden');
    }

    showNotification(message, type) {
        // Don't show notification for current user's actions
        if (message.includes(this.currentUser)) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        this.notifications.appendChild(notification);

        // Remove notification after animation
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    setupSocketListeners() {
        if (!this.socket) return;

        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('userJoined', (data) => {
            this.updateUsersList(data.users);
            this.showNotification(`${data.username} joined the chat`, 'join');
        });

        this.socket.on('userLeft', (data) => {
            this.updateUsersList(data.users);
            this.showNotification(`${data.username} left the chat`, 'leave');
        });

        this.socket.on('chatMessage', (message) => {
            this.displayMessage(message);
        });

        this.socket.on('userTyping', (username) => {
            if (username !== this.currentUser) {
                this.showTypingIndicator(username);
            }
        });

        this.socket.on('chatCleared', () => {
            this.chatMessages.innerHTML = '';
            this.showNotification('Chat has been cleared by admin', 'system');
        });

        this.socket.on('error', (error) => {
            this.showError(error);
            if (error.includes('banned')) {
                this.logout();
            }
        });

        this.socket.on('disconnect', () => {
            console.log('Disconnected from server');
            if (this.currentUser) {
                this.showError('Lost connection to server. Please refresh the page.');
            }
        });
    }

    initializeEventListeners() {
        // Login events
        this.loginBtn.addEventListener('click', () => this.handleLogin());
        this.usernameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });

        // Chat events
        this.messageInput.addEventListener('input', () => this.handleTyping());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        this.cancelReplyBtn.addEventListener('click', () => this.cancelReply());
        this.logoutBtn.addEventListener('click', async () => {
            await this.handleLogout();
        });

        // Admin events
        document.getElementById('clear-chat')?.addEventListener('click', () => this.clearChat());
        document.getElementById('ban-user')?.addEventListener('click', () => this.showBanUserDialog());
    }

    checkSession() {
        const session = localStorage.getItem('chatSession');
        if (session) {
            const { username, isAdmin } = JSON.parse(session);
            this.usernameInput.value = username;
            this.handleLogin(true);
        }
    }

    saveSession() {
        localStorage.setItem('chatSession', JSON.stringify({
            username: this.currentUser,
            isAdmin: this.isAdmin
        }));
    }

    clearSession() {
        localStorage.removeItem('chatSession');
    }

    async handleLogin(fromSession = false) {
        const username = this.usernameInput.value.trim();
        if (!username) return;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const data = await response.json();

            if (data.success) {
                this.currentUser = username;
                this.isAdmin = data.isAdmin;
                this.loginContainer.classList.add('hidden');
                this.chatContainer.classList.remove('hidden');
                
                // Setup socket connection
                this.socket = io({
                    transports: ['websocket', 'polling'],
                    upgrade: true,
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000,
                    timeout: 20000
                });
                this.setupSocketListeners();
                this.socket.emit('login', { username });

                // Show admin panel if admin
                if (this.isAdmin) {
                    this.adminPanel.classList.remove('hidden');
                }

                // Save session
                this.saveSession();

                // Display previous messages
                if (data.messages) {
                    data.messages.forEach(msg => this.displayMessage(msg));
                }

                document.getElementById('current-user').textContent = username;
            } else {
                this.showError(data.error);
            }
        } catch (error) {
            this.showError('Failed to login. Please try again.');
        }
    }

    async handleLogout() {
        try {
            if (this.currentUser) {
                const response = await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username: this.currentUser })
                });

                if (!response.ok) {
                    throw new Error('Failed to logout');
                }
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Always reset client state, even if server request fails
            this.currentUser = null;
            this.isAdmin = false;

            // Clear messages and user list
            this.chatMessages.innerHTML = '';
            this.usersList.innerHTML = '';

            // Reset inputs
            this.messageInput.value = '';
            this.usernameInput.value = '';

            // Hide chat container and show login form
            this.chatContainer.classList.add('hidden');
            this.loginContainer.classList.remove('hidden');

            // Hide admin panel if visible
            if (this.adminPanel) {
                this.adminPanel.classList.add('hidden');
            }

            // Disconnect from socket
            if (this.socket) {
                this.socket.disconnect();
            }

            // Clear session
            this.clearSession();
        }
    }

    startReply(message) {
        this.replyingTo = message;
        this.replyingToDiv.classList.remove('hidden');
        this.replyText.textContent = `Replying to ${message.username}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`;
        this.messageInput.focus();
    }

    cancelReply() {
        this.replyingTo = null;
        this.replyingToDiv.classList.add('hidden');
        this.replyText.textContent = '';
        this.messageInput.focus();
    }

    displayMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.username === this.currentUser ? 'own-message' : ''}`;
        messageDiv.dataset.messageId = message.id;

        const header = document.createElement('div');
        header.className = 'message-header';
        
        const username = document.createElement('span');
        username.className = 'username';
        username.textContent = message.username;
        
        const timestamp = document.createElement('span');
        timestamp.className = 'timestamp';
        timestamp.textContent = new Date(message.timestamp).toLocaleTimeString();
        
        header.appendChild(username);
        header.appendChild(timestamp);
        messageDiv.appendChild(header);

        if (message.replyTo) {
            const repliedMessage = document.createElement('div');
            repliedMessage.className = 'replied-message';
            
            const replyHeader = document.createElement('div');
            replyHeader.className = 'reply-header';
            replyHeader.innerHTML = `↩️ Replying to ${message.replyToUsername}`;
            
            const replyContent = document.createElement('div');
            replyContent.className = 'reply-content';
            replyContent.textContent = message.replyToContent;
            
            repliedMessage.appendChild(replyHeader);
            repliedMessage.appendChild(replyContent);
            messageDiv.appendChild(repliedMessage);
        }

        const content = document.createElement('div');
        content.className = 'message-content';

        if (message.type === 'image') {
            const img = document.createElement('img');
            img.src = message.content;
            img.alt = 'Shared image';
            img.addEventListener('click', () => window.open(img.src, '_blank'));
            content.appendChild(img);
        } else if (message.type === 'file') {
            const link = document.createElement('a');
            link.href = message.content;
            link.textContent = `📎 ${message.content.split('/').pop()}`;
            link.target = '_blank';
            content.appendChild(link);
        } else {
            content.textContent = message.content;
        }

        messageDiv.appendChild(content);

        const replyBtn = document.createElement('button');
        replyBtn.className = 'reply-btn';
        replyBtn.innerHTML = '↩️';
        replyBtn.title = 'Reply';
        replyBtn.onclick = () => this.startReply({
            id: message.id,
            username: message.username,
            content: message.content
        });
        messageDiv.appendChild(replyBtn);

        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    async handleFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;

        const formData = new FormData();
        Array.from(files).forEach(file => {
            formData.append('files', file);
        });

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (data.success) {
                data.urls.forEach(url => {
                    const fileExt = url.split('.').pop().toLowerCase();
                    const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(fileExt);
                    
                    this.socket.emit('chatMessage', {
                        content: url,
                        type: isImage ? 'image' : 'file',
                        username: this.currentUser,
                        timestamp: new Date().toISOString()
                    });
                });
            }
        } catch (error) {
            this.showError('Failed to upload file');
        }

        // Clear the input
        event.target.value = '';
    }

    sendMessage() {
        const content = this.messageInput.value.trim();
        if (!content && !this.fileInput.files.length) return;

        const message = {
            content,
            username: this.currentUser,
            timestamp: new Date().toISOString()
        };

        if (this.replyingTo) {
            message.replyTo = this.replyingTo.id;
            message.replyToContent = this.replyingTo.content;
            message.replyToUsername = this.replyingTo.username;
            this.cancelReply();
        }

        this.socket.emit('chatMessage', message);
        this.messageInput.value = '';
    }

    handleTyping() {
        clearTimeout(this.typingTimeout);
        this.socket.emit('typing', this.currentUser);

        this.typingTimeout = setTimeout(() => {
            this.socket.emit('stopTyping', this.currentUser);
        }, 1000);
    }

    showTypingIndicator(username) {
        this.typingIndicator.classList.remove('hidden');
        this.typingIndicator.textContent = `${username} is typing...`;

        clearTimeout(this.typingIndicatorTimeout);
        this.typingIndicatorTimeout = setTimeout(() => {
            this.typingIndicator.classList.add('hidden');
        }, 1000);
    }

    updateUsersList(users) {
        this.usersList.innerHTML = '';
        users.forEach(user => {
            const li = document.createElement('li');
            li.textContent = user.username;
            if (user.isAdmin) li.classList.add('admin');
            if (user.online) li.classList.add('online');
            this.usersList.appendChild(li);
        });
    }

    addSystemMessage(message) {
        const div = document.createElement('div');
        div.className = 'system-message';
        div.textContent = message;
        this.chatMessages.appendChild(div);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    showError(message) {
        alert(message);
    }

    // Admin functions
    clearChat() {
        if (!this.isAdmin) return;
        this.socket.emit('clearChat');
    }

    showBanUserDialog() {
        if (!this.isAdmin) return;
        const username = prompt('Enter username to ban:');
        if (username) {
            this.socket.emit('banUser', username);
        }
    }
}

// Initialize the chat app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});
