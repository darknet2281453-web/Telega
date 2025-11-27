import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server);

// Важно: раздаем статические файлы ДО других маршрутов
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

const DATA_FILE = 'data.json';

// Загрузка данных
function loadData() {
    if (existsSync(DATA_FILE)) {
        return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    }
    return {
        users: [],
        chats: [],
        messages: {},
        userCounter: 1,
        chatCounter: 1
    };
}

// Сохранение данных
function saveData() {
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

// Автозапись каждые 30 секунд
setInterval(saveData, 30000);

// Главная страница - ДОЛЖНА БЫТЬ ПОСЛЕ static!
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

// API для регистрации
app.post('/register', (req, res) => {
    const { username, password, displayName } = req.body;
    
    if (!username || !password || !displayName) {
        return res.json({ success: false, error: 'Все поля обязательны' });
    }
    
    if (data.users.find(u => u.username === username)) {
        return res.json({ success: false, error: 'Username уже занят' });
    }
    
    const user = {
        id: data.userCounter.toString().padStart(5, '0'),
        username: username.startsWith('@') ? username : '@' + username,
        password: password,
        displayName,
        online: false,
        registered: new Date().toISOString()
    };
    
    data.users.push(user);
    data.userCounter++;
    saveData();
    
    res.json({ success: true, user: { id: user.id, username: user.username, displayName } });
});

// API для логина
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    
    const user = data.users.find(u => 
        u.username === (username.startsWith('@') ? username : '@' + username) && 
        u.password === password
    );
    
    if (user) {
        user.online = true;
        saveData();
        res.json({ success: true, user: { id: user.id, username: user.username, displayName: user.displayName } });
    } else {
        res.json({ success: false, error: 'Неверный логин или пароль' });
    }
});

// API для поиска пользователей
app.get('/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);
    
    const results = data.users.filter(user => 
        user.username.toLowerCase().includes(q.toLowerCase()) ||
        user.displayName.toLowerCase().includes(q.toLowerCase())
    ).map(user => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        online: user.online
    }));
    
    res.json(results);
});

// API для создания чата/канала
app.post('/create-chat', (req, res) => {
    const { name, type, creatorId } = req.body;
    
    const chat = {
        id: data.chatCounter.toString().padStart(5, '0'),
        name,
        type,
        creatorId,
        members: [creatorId],
        created: new Date().toISOString(),
        memberCount: 1
    };
    
    if (type === 'channel') {
        chat.subscribers = [creatorId];
        chat.subscriberCount = 1;
    }
    
    data.chats.push(chat);
    data.messages[chat.id] = [];
    data.chatCounter++;
    saveData();
    
    res.json({ success: true, chat });
});

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);
    
    let currentUser = null;
    
    socket.on('userLogin', (user) => {
        currentUser = user;
        const userChats = data.chats.filter(chat => 
            chat.members.includes(user.id) || 
            (chat.type === 'channel' && chat.subscribers.includes(user.id))
        );
        
        socket.emit('chatsList', userChats);
    });
    
    socket.on('joinChat', (chatId) => {
        socket.join(chatId);
        if (data.messages[chatId]) {
            socket.emit('messageHistory', data.messages[chatId]);
        }
    });
    
    socket.on('sendMessage', (messageData) => {
        const { chatId, text } = messageData;
        
        if (!data.messages[chatId]) {
            data.messages[chatId] = [];
        }
        
        const message = {
            id: Date.now(),
            text,
            chatId,
            userId: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            time: new Date().toLocaleTimeString(),
            timestamp: Date.now()
        };
        
        data.messages[chatId].push(message);
        saveData();
        
        io.to(chatId).emit('newMessage', message);
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            const user = data.users.find(u => u.id === currentUser.id);
            if (user) user.online = false;
            saveData();
        }
        console.log('Пользователь отключился:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📁 Текущая директория: ${__dirname}`);
});
