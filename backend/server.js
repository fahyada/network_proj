const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuration: Allow large payloads for images (10MB)
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

// SERVE FRONTEND FILES
// We point to the parent directory's 'frontend' folder
app.use(express.static(path.join(__dirname, '../frontend')));

// --- DATABASE (In-Memory) ---
const users = new Map(); // Key: socket.id, Value: { username, avatar, status }
const usernames = new Set(); // To quickly check duplicates
const groups = new Map(); // Key: groupName, Value: Set(usernames)

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let currentUser = null;

    // 1. CHECK USERNAME (Used by Login Page)
    socket.on('check_username', (username, callback) => {
        if (usernames.has(username)) {
            callback({ available: false });
        } else {
            callback({ available: true });
        }
    });

    // 2. LOGIN (Used by Chat Page)
    socket.on('login', ({ username, avatar, status }) => {
        if (usernames.has(username)) {
            // Handle reconnection or duplicate attempt
             // For simplicity, we allow reconnects if name matches, 
             // but in production, you'd use sessions.
        }
        
        currentUser = username;
        usernames.add(username);
        users.set(socket.id, { username, avatar, status: status || 'Online' });
        
        socket.join(username); // Join private room
        
        // Broadcast updates
        io.emit('update_users', getUserList());
        socket.emit('update_groups', getGroupList());
    });

    // 3. STATUS UPDATE
    socket.on('set_status', (status) => {
        if (users.has(socket.id)) {
            users.get(socket.id).status = status;
            io.emit('update_users', getUserList());
        }
    });

    // 4. PRIVATE MESSAGE (Text & Image)
    socket.on('private_message', ({ to, content, type }) => {
        const sender = users.get(socket.id);
        const recipientSocketId = [...users.entries()]
            .find(([_, data]) => data.username === to)?.[0];

        const msgData = {
            from: sender.username,
            to: to,
            content,
            type, // 'text' or 'image'
            avatar: sender.avatar,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        if (recipientSocketId) {
            io.to(recipientSocketId).emit('receive_private', msgData);
        }
        socket.emit('receive_private', msgData); // Echo to sender
    });

    // 5. GROUP MESSAGE
    socket.on('group_message', ({ groupName, content, type }) => {
        const sender = users.get(socket.id);
        if (groups.has(groupName) && groups.get(groupName).has(sender.username)) {
            io.to(groupName).emit('receive_group', {
                group: groupName,
                from: sender.username,
                content,
                type,
                avatar: sender.avatar,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
    });

    // 6. TYPING INDICATOR
    socket.on('typing', ({ target, type }) => {
        const sender = users.get(socket.id);
        if (type === 'private') {
             const recipientSocketId = [...users.entries()]
                .find(([_, data]) => data.username === target)?.[0];
             if(recipientSocketId) io.to(recipientSocketId).emit('display_typing', { from: sender.username, isGroup: false });
        } else {
            socket.to(target).emit('display_typing', { from: sender.username, isGroup: true, group: target });
        }
    });

    socket.on('stop_typing', ({ target, type }) => {
         const sender = users.get(socket.id);
         if (type === 'private') {
             const recipientSocketId = [...users.entries()]
                .find(([_, data]) => data.username === target)?.[0];
             if(recipientSocketId) io.to(recipientSocketId).emit('hide_typing', { from: sender.username });
         } else {
             socket.to(target).emit('hide_typing', { from: sender.username });
         }
    });

    // 7. GROUPS MANAGEMENT
    socket.on('create_group', (groupName) => {
        if (!groups.has(groupName)) {
            groups.set(groupName, new Set([currentUser]));
            socket.join(groupName);
            io.emit('update_groups', getGroupList());
        }
    });

    socket.on('join_group', (groupName) => {
        if (groups.has(groupName)) {
            groups.get(groupName).add(currentUser);
            socket.join(groupName);
            io.emit('update_groups', getGroupList());
        }
    });

    // DISCONNECT
    socket.on('disconnect', () => {
        if (currentUser) {
            usernames.delete(currentUser);
            users.delete(socket.id);
            // Remove from groups
            groups.forEach(members => members.delete(currentUser));
            io.emit('update_users', getUserList());
        }
    });

    // Helpers
    function getUserList() {
        return Array.from(users.values());
    }
    function getGroupList() {
        const list = [];
        groups.forEach((members, name) => {
            list.push({ name, members: Array.from(members) });
        });
        return list;
    }
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
