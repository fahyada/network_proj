const { createApp, ref, computed, nextTick, reactive } = Vue;
const socket = io();

createApp({
    setup() {
        // State
        const myUsername = ref(sessionStorage.getItem('chat_username'));
        const myAvatar = ref(sessionStorage.getItem('chat_avatar'));
        const myStatus = ref('Online');
        
        const users = ref([]);
        const groups = ref([]);
        const activeChat = ref(null); // { type: 'private'|'group', id: 'name' }
        const messages = reactive({}); // Map 'type:id' -> []
        const inputMessage = ref('');
        const typingInfo = ref('');

        // Redirect if not logged in
        if (!myUsername.value) {
            window.location.href = '/index.html';
        }

        // Connect & Login
        socket.emit('login', { 
            username: myUsername.value, 
            avatar: myAvatar.value 
        });

        // --- ACTIONS ---

        const updateStatus = () => {
            socket.emit('set_status', myStatus.value);
        };

        const selectChat = (type, id) => {
            if (type === 'private' && id === myUsername.value) return;
            activeChat.value = { type, id };
            typingInfo.value = '';
            scrollToBottom();
        };

        const createGroup = () => {
            const name = prompt("Enter Group Name:");
            if (name) socket.emit('create_group', name);
        };

        const joinGroup = (name) => {
            socket.emit('join_group', name);
        };

        const sendMessage = () => {
            if (!inputMessage.value.trim() || !activeChat.value) return;
            
            const payload = {
                content: inputMessage.value,
                type: 'text'
            };
            emitMessage(payload);
            inputMessage.value = '';
        };

        const sendImage = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = () => {
                emitMessage({ content: reader.result, type: 'image' });
            };
            reader.readAsDataURL(file);
            e.target.value = ''; // Reset input
        };

        const emitMessage = (payload) => {
            if (activeChat.value.type === 'private') {
                socket.emit('private_message', { to: activeChat.value.id, ...payload });
            } else {
                socket.emit('group_message', { groupName: activeChat.value.id, ...payload });
            }
        };

        // Typing Logic
        let typingTimeout;
        const handleTyping = () => {
            if (!activeChat.value) return;
            socket.emit('typing', { target: activeChat.value.id, type: activeChat.value.type });
            
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('stop_typing', { target: activeChat.value.id, type: activeChat.value.type });
            }, 1000);
        };

        // --- HELPERS ---

        const isMember = (groupName) => {
            const grp = groups.value.find(g => g.name === groupName);
            return grp && grp.members.includes(myUsername.value);
        };

        const getStatusColor = (status) => {
            switch(status) {
                case 'Online': return 'bg-green-500';
                case 'Busy': return 'bg-red-500';
                case 'Away': return 'bg-yellow-500';
                default: return 'bg-slate-500';
            }
        };

        const scrollToBottom = async () => {
            await nextTick();
            const container = document.getElementById('messages');
            if (container) container.scrollTop = container.scrollHeight;
        };

        const addMessage = (key, msg) => {
            if (!messages[key]) messages[key] = [];
            messages[key].push(msg);
            if (activeChat.value && key === `${activeChat.value.type}:${activeChat.value.id}`) {
                scrollToBottom();
            }
        };

        const isActive = (type, id) => {
            return activeChat.value && activeChat.value.type === type && activeChat.value.id === id;
        };

        // --- COMPUTED ---
        const currentMessages = computed(() => {
            if (!activeChat.value) return [];
            const key = `${activeChat.value.type}:${activeChat.value.id}`;
            return messages[key] || [];
        });

        // Members of the currently active group (array of usernames)
        const currentGroupMembers = computed(() => {
            if (!activeChat.value || activeChat.value.type !== 'group') return [];
            const grp = groups.value.find(g => g.name === activeChat.value.id);
            return grp ? grp.members : [];
        });

        // Resolve avatar URL for a username (fallback if unknown)
        const getAvatar = (username) => {
            if (username === myUsername.value) return myAvatar.value;
            const u = users.value.find(x => x.username === username);
            return u ? u.avatar : 'https://via.placeholder.com/40/334155/ffffff?text=?';
        };

        // --- SOCKET EVENTS ---

        socket.on('update_users', (list) => {
            // Filter out self from list
            users.value = list.filter(u => u.username !== myUsername.value);
        });

        socket.on('update_groups', (list) => groups.value = list);

        socket.on('receive_private', (msg) => {
            // Determine chat key: if I sent it, key is receiver. If I got it, key is sender.
            const other = msg.from === myUsername.value ? msg.to : msg.from;
            addMessage(`private:${other}`, msg);
        });

        socket.on('receive_group', (msg) => {
            addMessage(`group:${msg.group}`, msg);
        });

        socket.on('display_typing', ({ from, isGroup, group }) => {
            if (!activeChat.value) return;
            
            // Only show if we are looking at that specific chat
            if (isGroup && activeChat.value.type === 'group' && activeChat.value.id === group) {
                if (from !== myUsername.value) typingInfo.value = `${from} is typing...`;
            } 
            else if (!isGroup && activeChat.value.type === 'private' && activeChat.value.id === from) {
                typingInfo.value = `${from} is typing...`;
            }
        });

        socket.on('hide_typing', () => {
            typingInfo.value = '';
        });

        return {
            myUsername, myAvatar, myStatus, updateStatus,
            users, groups, activeChat, currentMessages,
            currentGroupMembers, getAvatar,
            selectChat, createGroup, joinGroup, isActive,
            inputMessage, sendMessage, sendImage,
            handleTyping, typingInfo, isMember, getStatusColor
        };
    }
}).mount('#app');
