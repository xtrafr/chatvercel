class ChatApp {
    constructor() {
        this.currentUser = null;
        this.userId = null;
        this.isAdmin = false;
        this.typingTimeout = null;
        this.typingIndicatorTimeout = null;
        this.replyingTo = null;
        this.lastMessageId = null;
        this.pollingInterval = null;
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
        if (message.includes(this.currentUser)) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        this.notifications.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    startPolling() {
        // Clear any existing polling interval
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        // Start polling for new messages and updates
        const pollServer = async () => {
            if (!this.userId) {
                console.error('No userId available for polling');
                return;
            }

            try {
                const response = await fetch(`/api/messages?userId=${this.userId}&lastId=${this.lastMessageId || ''}`);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();

                if (data.success) {
                    // Update messages
                    if (data.messages && data.messages.length > 0) {
                        data.messages.forEach(msg => {
                            this.displayMessage(msg);
                            if (msg.id) {
                                this.lastMessageId = msg.id;
                            }
                        });
                    }

                    // Update typing indicators
                    if (data.typing && data.typing.length > 0) {
                        this.showTypingIndicator(data.typing.join(', '));
                    }

                    // Update user list
                    if (data.users) {
                        this.updateUsersList(data.users);
                    }
                } else if (data.error) {
                    console.error('Server error:', data.error);
                }
            } catch (error) {
                console.error('Polling error:', error);
                this.addSystemMessage('Error connecting to server. Retrying...');
            }
        };

        // Poll every 2 seconds
        this.pollingInterval = setInterval(pollServer, 2000);
        // Initial poll
        pollServer();
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
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
        this.logoutBtn.addEventListener('click', () => this.handleLogout());

        // Admin events
        document.getElementById('clear-chat')?.addEventListener('click', () => this.clearChat());
        document.getElementById('ban-user')?.addEventListener('click', () => this.showBanUserDialog());
    }

    checkSession() {
        const session = localStorage.getItem('chatSession');
        if (session) {
            try {
                const { username, userId, isAdmin } = JSON.parse(session);
                this.usernameInput.value = username;
                this.userId = userId;
                this.isAdmin = isAdmin;
                this.handleLogin(true);
            } catch (error) {
                console.error('Error parsing session:', error);
                this.clearSession();
            }
        }
    }

    saveSession() {
        localStorage.setItem('chatSession', JSON.stringify({
            username: this.currentUser,
            userId: this.userId,
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
                this.userId = data.userId;
                this.isAdmin = data.isAdmin;
                this.loginContainer.classList.add('hidden');
                this.chatContainer.classList.remove('hidden');

                // Show admin panel if admin
                if (this.isAdmin) {
                    this.adminPanel.classList.remove('hidden');
                }

                // Save session
                this.saveSession();

                // Update current user display
                document.getElementById('current-user').textContent = username;

                // Display previous messages
                if (data.messages && Array.isArray(data.messages)) {
                    data.messages.forEach(msg => {
                        this.displayMessage(msg);
                        if (msg.id) {
                            this.lastMessageId = msg.id;
                        }
                    });
                }

                // Update user list
                if (data.onlineUsers && Array.isArray(data.onlineUsers)) {
                    this.updateUsersList(data.onlineUsers);
                }

                // Start polling for updates only after we have userId
                if (this.userId) {
                    this.startPolling();
                }
            } else {
                this.showError(data.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Failed to login. Please try again.');
        }
    }

    async handleLogout() {
        try {
            if (this.userId) {
                const response = await fetch('/api/logout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ userId: this.userId })
                });

                if (!response.ok) {
                    throw new Error('Failed to logout');
                }
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            // Stop polling
            this.stopPolling();

            // Reset client state
            this.currentUser = null;
            this.userId = null;
            this.isAdmin = false;
            this.lastMessageId = null;

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
        if (!message || !message.content) return;

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

        if (message.type === 'system') {
            content.classList.add('system-message');
            content.textContent = message.content;
        } else if (message.type === 'image') {
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

        // Only add reply button for non-system messages
        if (message.type !== 'system') {
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
        }

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
            if (data.success && data.urls) {
                for (const url of data.urls) {
                    const fileExt = url.split('.').pop().toLowerCase();
                    const isImage = ['jpg', 'jpeg', 'png', 'gif'].includes(fileExt);
                    
                    await this.sendMessage({
                        content: url,
                        type: isImage ? 'image' : 'file'
                    });
                }
            } else {
                throw new Error(data.error || 'Failed to upload file');
            }
        } catch (error) {
            console.error('File upload error:', error);
            this.showError('Failed to upload file');
        }

        // Clear the input
        event.target.value = '';
    }

    async sendMessage(fileMessage = null) {
        const content = fileMessage ? fileMessage.content : this.messageInput.value.trim();
        if (!content) return;

        try {
            const messageData = {
                userId: this.userId,
                content,
                type: fileMessage ? fileMessage.type : 'text'
            };

            if (this.replyingTo) {
                messageData.replyTo = this.replyingTo.id;
                messageData.replyToUsername = this.replyingTo.username;
                messageData.replyToContent = this.replyingTo.content;
                this.cancelReply();
            }

            const response = await fetch('/api/send-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(messageData)
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to send message');
            }

            if (!fileMessage) {
                this.messageInput.value = '';
            }
        } catch (error) {
            console.error('Error sending message:', error);
            this.showError('Failed to send message');
        }
    }

    async handleTyping() {
        clearTimeout(this.typingTimeout);
        
        try {
            await fetch('/api/typing', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    isTyping: true
                })
            });

            this.typingTimeout = setTimeout(async () => {
                try {
                    await fetch('/api/typing', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            userId: this.userId,
                            isTyping: false
                        })
                    });
                } catch (error) {
                    console.error('Error updating typing status:', error);
                }
            }, 1000);
        } catch (error) {
            console.error('Error updating typing status:', error);
        }
    }

    showTypingIndicator(usernamesString) {
        this.typingIndicator.classList.remove('hidden');
        this.typingIndicator.querySelector('span').textContent = `${usernamesString} is typing...`;

        clearTimeout(this.typingIndicatorTimeout);
        this.typingIndicatorTimeout = setTimeout(() => {
            this.typingIndicator.classList.add('hidden');
        }, 1000);
    }

    updateUsersList(users) {
        if (!Array.isArray(users)) return;
        
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
        this.displayMessage({
            id: Date.now().toString(),
            type: 'system',
            content: message,
            timestamp: new Date().toISOString()
        });
    }

    showError(message) {
        if (message.includes('banned') || message.includes('Username already taken')) {
            alert(message);
        } else {
            this.addSystemMessage(`Error: ${message}`);
            console.error('Error:', message);
        }
    }

    async clearChat() {
        if (!this.isAdmin || !this.userId) return;
        
        try {
            const response = await fetch('/api/admin/clear-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to clear chat');
            }
            
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to clear chat');
            }
            
            // Clear messages locally
            this.chatMessages.innerHTML = '';
            this.lastMessageId = null;
        } catch (error) {
            console.error('Error clearing chat:', error);
            this.showError('Failed to clear chat');
        }
    }

    showBanUserDialog() {
        if (!this.isAdmin || !this.userId) return;
        
        const username = prompt('Enter username to ban:');
        if (username) {
            this.banUser(username);
        }
    }
    
    async banUser(username) {
        try {
            const response = await fetch('/api/admin/ban-user', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: this.userId,
                    username
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to ban user');
            }
            
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to ban user');
            }
        } catch (error) {
            console.error('Error banning user:', error);
            this.showError('Failed to ban user');
        }
    }
}

// Initialize the chat app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatApp();
});
