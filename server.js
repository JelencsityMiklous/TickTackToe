const express = require("express")
const http = require("http")
const socketIO = require("socket.io")
const path = require("path")
const app = express()
const server = http.createServer(app)
const io = socketIO(server)

// view engine

app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "views"))

// statikus fajlok

app.use(express.static(path.join(__dirname, "public")))
app.use(express.urlencoded({ extended: true }))

// szba tarolas memoraiban

const rooms = new Map()

// szoba struktura

class Room {
  constructor(code) {
    this.code = code
    this.players = [] // max 2 jatekos
    this.board = Array(9).fill("")
    this.turn = "X"
    this.status = "waiting" // varakoszas
    this.winner = null
    this.rematchReady = new Set()
    this.spectators = [] // nezok
  }

  addPlayer(socketId, name) {
    if (this.players.length >= 2) return false
    const symbol = this.players.length === 0 ? "X" : "O"
    this.players.push({ socketId, name, symbol })
    if (this.players.length === 2) {
      this.status = "playing"
    }
    return symbol
  }

  addSpectator(socketId, name) {
    this.spectators.push({ socketId, name })
  }

  removePlayer(socketId) {
    const index = this.players.findIndex((p) => p.socketId === socketId)
    if (index !== -1) {
      this.players.splice(index, 1)
      this.resetGame()
      return true
    }

    // nezo eltavolitas

    const specIndex = this.spectators.findIndex((s) => s.socketId === socketId)
    if (specIndex !== -1) {
      this.spectators.splice(specIndex, 1)
    }
    return false
  }

  resetGame() {
    this.board = Array(9).fill("")
    this.turn = "X"
    this.status = this.players.length === 2 ? "playing" : "waiting"
    this.winner = null
    this.rematchReady.clear()
  }

  makeMove(socketId, index) {
    const player = this.players.find((p) => p.socketId === socketId)
    if (!player) return { success: false, error: "Nem vagy játékos" }
    if (this.status !== "playing")
      return { success: false, error: "A játék nem fut" }
    if (player.symbol !== this.turn)
      return { success: false, error: "Nem te következel" }
    if (this.board[index] !== "")
      return { success: false, error: "A mező foglalt" }
    this.board[index] = player.symbol

    // gyozelem

    if (this.checkWinner()) {
      this.status = "finished"
      this.winner = player.symbol
    } else if (this.board.every((cell) => cell !== "")) {
      // dontetlen
      this.status = "finished"
      this.winner = "draw"
    } else {
      // kovi jatekos

      this.turn = this.turn === "X" ? "O" : "X"
    }
    return { success: true }
  }

  checkWinner() {
    const winPatterns = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8], // sorok

      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8], // oszlopok

      [0, 4, 8],
      [2, 4, 6], // atlok
    ]

    return winPatterns.some((pattern) => {
      const [a, b, c] = pattern
      return (
        this.board[a] !== "" &&
        this.board[a] === this.board[b] &&
        this.board[a] === this.board[c]
      )
    })
  }

  addRematchReady(socketId) {
    this.rematchReady.add(socketId)
    if (this.rematchReady.size === 2) {
      this.resetGame()
      return true // uj jatek
    }
    return false
  }

  getState() {
    return {
      board: this.board,
      turn: this.turn,
      status: this.status,
      winner: this.winner,
    }
  }
}

// routes

app.get("/", (req, res) => {
  res.render("index")
})

app.get("/room/:code", (req, res) => {
  res.render("room", { roomCode: req.params.code })
})

// socketio esemenyek

io.on("connection", (socket) => {
  console.log("Új kapcsolat:", socket.id)

  // szoba csatlakozas

  socket.on("joinRoom", ({ playerName, roomCode, asSpectator }) => {
    // validacio

    if (!playerName || playerName.length < 3) {
      socket.emit("errorMessage", {
        message: "A név legalább 3 karakter legyen!",
      })
      return
    }

    if (!roomCode) {
      socket.emit("errorMessage", { message: "Add meg a szoba kódját!" })
      return
    }

    // szoba letrehozas
    if (!rooms.has(roomCode)) {
      rooms.set(roomCode, new Room(roomCode))
    }
    const room = rooms.get(roomCode)

    // nezomod

    if (asSpectator || room.players.length >= 2) {
      if (!asSpectator && room.players.length >= 2) {
        // tele a szboa akkor nezokent dob be
        socket.emit("errorMessage", {
          message: "A szoba megtelt. Nézőként csatlakoztál.",
          spectatorMode: true,
        })
      }

      room.addSpectator(socket.id, playerName)
      socket.join(roomCode)
      socket.emit("roomJoined", {
        roomCode,
        symbol: null,
        players: room.players.map((p) => ({ name: p.name, symbol: p.symbol })),
        status: room.status,
        spectator: true,
      })

      socket.emit("stateUpdate", room.getState())
      return
    }

    // jatekoscsatlak

    const symbol = room.addPlayer(socket.id, playerName)
    if (!symbol) {
      socket.emit("errorMessage", { message: "A szoba megtelt." })
      return
    }

    socket.join(roomCode)
    socket.data.roomCode = roomCode
    socket.data.playerName = playerName

    // feedback a jatekosnak

    socket.emit("roomJoined", {
      roomCode,

      symbol,

      players: room.players.map((p) => ({ name: p.name, symbol: p.symbol })),

      status: room.status,
    })

    // allapot

    io.to(roomCode).emit("stateUpdate", room.getState())
  })

  // llepes
  socket.on("makeMove", ({ roomCode, index }) => {
    const room = rooms.get(roomCode)
    if (!room) {
      socket.emit("errorMessage", { message: "A szoba nem létezik." })
      return
    }

    const result = room.makeMove(socket.id, index)
    if (!result.success) {
      socket.emit("errorMessage", { message: result.error })
      return
    }

    // allapotfrissites
    io.to(roomCode).emit("stateUpdate", room.getState())
  })

  // rematch
  socket.on("requestRematch", ({ roomCode }) => {
    const room = rooms.get(roomCode)
    if (!room) return
    const newGameStarted = room.addRematchReady(socket.id)
    // statusz
    io.to(roomCode).emit("rematchStatus", {
      readyCount: room.rematchReady.size,
    })
    if (newGameStarted) {
      io.to(roomCode).emit("stateUpdate", room.getState())
    }
  })

  // kilepes
  socket.on("disconnect", () => {
    console.log("Kapcsolat bontva:", socket.id)
    const roomCode = socket.data.roomCode
    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode)
      const wasPlayer = room.removePlayer(socket.id)
      if (wasPlayer) {
        io.to(roomCode).emit("opponentLeft", {
          message: "Az ellenfél kilépett.",
        })
        io.to(roomCode).emit("stateUpdate", room.getState())
      }

      // ures szoba torles
      if (room.players.length === 0 && room.spectators.length === 0) {
        rooms.delete(roomCode)
      }
    }
  })
})

const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
  console.log(`Szerver hallgat: http://localhost:${PORT}`)
})
