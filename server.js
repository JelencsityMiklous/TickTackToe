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

const rooms = new Map();

class Room {
  constructor(code) {
    this.code = code;
    this.players = [];
    this.board = Array(9).fill('');
    this.turn = 'X';
    this.status = 'waiting';
    this.winner = null;
    this.rematchReady = new Set();
  }

  addPlayer(socketId, name) {
    if (this.players.length >= 2) return false;
    const symbol = this.players.length === 0 ? 'X' : 'O';
    this.players.push({ socketId, name, symbol });
    if (this.players.length === 2) {
      this.status = 'playing';
    }
    return symbol;
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(p => p.socketId === socketId);
    if (index !== -1) {
      this.players.splice(index, 1);
      this.resetGame();
      return true;
    }

    return false;
  }

  resetGame() {
    this.board = Array(9).fill('');
    this.turn = 'X';
    this.status = this.players.length === 2 ? 'playing' : 'waiting';
    this.winner = null;
    this.rematchReady.clear();
  }

  makeMove(socketId, index) {
    const player = this.players.find(p => p.socketId === socketId);
    if (!player) return { success: false, error: 'Nem vagy játékos' };
    if (this.status !== 'playing') return { success: false, error: 'A játék nem fut' };
    if (player.symbol !== this.turn) return { success: false, error: 'Nem te következel' };
    if (this.board[index] !== '') return { success: false, error: 'A mező foglalt' };
 
    this.board[index] = player.symbol;

    if (this.checkWinner()) {
      this.status = 'finished';
      this.winner = player.symbol;
    } else if (this.board.every(cell => cell !== '')) {
      this.status = 'finished';
      this.winner = 'draw';
    } else {
      this.turn = this.turn === 'X' ? 'O' : 'X';
    }
    return { success: true };
  }

  checkWinner() {
    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6]
    ];
 
    return winPatterns.some(pattern => {
      const [a, b, c] = pattern;
      return this.board[a] !== '' &&
             this.board[a] === this.board[b] &&
             this.board[a] === this.board[c];
    });
  }

  addRematchReady(socketId) {
    this.rematchReady.add(socketId);
    if (this.rematchReady.size === 2) {
      this.resetGame();
      return true;
    }
    return false;
  }

  getState() {
    return {
      board: this.board,
      turn: this.turn,
      status: this.status,
      winner: this.winner
    };
  }

}


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