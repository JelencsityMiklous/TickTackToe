const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));


// lobby
app.get('/', (req, res) => {
  res.render('index');
});

// szoba
app.get('/room/:roomCode', (req, res) => {
  const roomCode = req.params.roomCode;
  res.render('room', { roomCode });
});

// socketio kapcsolat kezelese
io.on('connection', (socket) => {
  console.log('Új játékos csatlakozott:', socket.id);

  socket.on('joinRoom', (data) => {
    // jatek logika majd
    console.log(`${data.playerName} csatlakozott a(z) ${data.roomCode} szobához`);
  });

  socket.on('disconnect', () => {
    console.log('Játékos kilépett:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Szerver hallgatózik: http://localhost:${PORT}`);
});