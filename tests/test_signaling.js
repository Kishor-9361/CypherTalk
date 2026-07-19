const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'encrypted-video-call-secure-secret-key-2026';

// Create mock tokens aligning with the new userId schema
const token1 = jwt.sign({ userId: 'user1', email: 'user1@cyphertalk.com', displayName: 'User1' }, JWT_SECRET);
const token2 = jwt.sign({ userId: 'user2', email: 'user2@cyphertalk.com', displayName: 'User2' }, JWT_SECRET);

const socket1 = io('http://localhost:3000', { auth: { token: token1 } });
const socket2 = io('http://localhost:3000', { auth: { token: token2 } });

socket1.on('connect', () => console.log('Socket1 connected'));
socket2.on('connect', () => console.log('Socket2 connected'));

socket2.on('incoming-call', (data) => {
    console.log('Socket2 received call:', data);
    socket2.emit('accept-call', { toUserId: 'user1', answer: 'mock-answer' });
});

socket1.on('call-accepted', (data) => {
    console.log('Socket1 received call-accepted:', data);
    process.exit(0);
});

setTimeout(() => {
    console.log('Socket1 initiating call to Socket2');
    socket1.emit('call-user', { toUserId: 'user2', offer: 'mock-offer' });
}, 1000);
