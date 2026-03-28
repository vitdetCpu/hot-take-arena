import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { judgeSubmissions } from "./minimax.js";

// ---------------------------------------------------------------------------
// Express + HTTP + Socket.IO
// ---------------------------------------------------------------------------

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// Serve built Vite output in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "..", "dist")));

// SPA fallback — serve index.html for any non-API route
app.get("*", (_req, res) => {
  const index = path.join(__dirname, "..", "dist", "index.html");
  res.sendFile(index, (err) => {
    if (err) res.status(404).end();
  });
});

// ---------------------------------------------------------------------------
// Room management (in-memory)
// ---------------------------------------------------------------------------

/** @type {Map<string, Room>} */
const rooms = new Map();

// Letters excluding I, L, O to avoid ambiguity
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const VOWELS = "AEU";
const CONSONANTS = "BCDFGHJKMNPQRSTVWXYZ";

/**
 * Generate a pronounceable 4-char room code using consonant-vowel patterns.
 * Patterns: CVCV, CVCC, CCVC — gives codes like BAKE, ZUMP, FIRE.
 */
function generateRoomCode() {
  const pick = (chars) => chars[Math.floor(Math.random() * chars.length)];

  const patterns = [
    [CONSONANTS, VOWELS, CONSONANTS, VOWELS], // CVCV  e.g. BAKE
    [CONSONANTS, VOWELS, CONSONANTS, CONSONANTS], // CVCC  e.g. ZUMP
    [CONSONANTS, CONSONANTS, VOWELS, CONSONANTS], // CCVC  e.g. GRAB
  ];

  // Try up to 50 times to find a unique code
  for (let attempt = 0; attempt < 50; attempt++) {
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const code = pattern.map(pick).join("");
    if (!rooms.has(code)) return code;
  }

  // Fallback: random 4-letter code
  let code;
  do {
    code = Array.from({ length: 4 }, () => pick(LETTERS)).join("");
  } while (rooms.has(code));
  return code;
}

/**
 * Create a fresh room object.
 */
function createRoom(hostSocketId) {
  return {
    hostSocketId,
    players: new Map(), // socketId → { name, submission }
    prompt: null,
    phase: "lobby", // 'lobby' | 'prompting' | 'submitting' | 'judging' | 'results'
    results: [],
  };
}

// Reverse lookup: socketId → roomCode (for disconnect cleanup)
const socketRoomMap = new Map();

// ---------------------------------------------------------------------------
// Utility: detect local network IP
// ---------------------------------------------------------------------------

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// ---------------------------------------------------------------------------
// Socket.IO event handlers
// ---------------------------------------------------------------------------

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // -----------------------------------------------------------------------
  // HOST EVENTS
  // -----------------------------------------------------------------------

  socket.on("host:create-room", () => {
    const roomCode = generateRoomCode();
    const room = createRoom(socket.id);
    rooms.set(roomCode, room);
    socket.join(roomCode);
    socketRoomMap.set(socket.id, roomCode);

    const localIP = getLocalIP();
    console.log(`[room] ${roomCode} created by ${socket.id}`);
    socket.emit("room:created", { roomCode, localIP });
  });

  socket.on("host:push-prompt", ({ roomCode, prompt }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.prompt = prompt;
    room.phase = "submitting";
    console.log(`[room ${roomCode}] prompt set, phase → submitting`);
    io.to(roomCode).emit("room:prompt", { prompt });
  });

  socket.on("host:start-judging", async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.phase = "judging";
    console.log(`[room ${roomCode}] phase → judging`);

    // Build submissions array
    const submissions = [];
    let idx = 1;
    for (const [, player] of room.players) {
      if (player.submission) {
        submissions.push({
          index: idx,
          playerName: player.name,
          text: player.submission,
        });
        idx++;
      }
    }

    if (submissions.length === 0) {
      room.phase = "results";
      io.to(roomCode).emit("room:judging-complete", { totalResults: 0 });
      return;
    }

    try {
      const results = await judgeSubmissions(
        room.prompt,
        submissions,
        (roast) => {
          room.results.push(roast);
          io.to(roomCode).emit("room:roast", roast);
        }
      );

      room.phase = "results";
      console.log(
        `[room ${roomCode}] judging complete, ${results.length} roasts`
      );
      io.to(roomCode).emit("room:judging-complete", {
        totalResults: results.length,
      });
    } catch (err) {
      console.error(`[room ${roomCode}] judging error:`, err.message);
      // Still transition to results so the game isn't stuck
      room.phase = "results";
      io.to(roomCode).emit("room:judging-complete", {
        totalResults: room.results.length,
      });
    }
  });

  socket.on("host:next-round", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Reset for next round
    for (const [, player] of room.players) {
      player.submission = null;
    }
    room.results = [];
    room.prompt = null;
    room.phase = "lobby";

    console.log(`[room ${roomCode}] reset for next round`);
    io.to(roomCode).emit("room:reset");
  });

  // -----------------------------------------------------------------------
  // PLAYER EVENTS
  // -----------------------------------------------------------------------

  socket.on("player:join", ({ roomCode, playerName }) => {
    // Normalize to uppercase so players can type lowercase codes
    const code = roomCode?.toUpperCase?.() ?? roomCode;

    const room = rooms.get(code);
    if (!room) {
      socket.emit("error:room-not-found", {
        message: `Room ${roomCode} does not exist`,
      });
      return;
    }

    room.players.set(socket.id, { name: playerName, submission: null });
    socket.join(code);
    socketRoomMap.set(socket.id, code);

    const playerCount = room.players.size;
    console.log(
      `[room ${code}] ${playerName} joined (${playerCount} players)`
    );
    io.to(code).emit("room:player-joined", {
      playerName,
      playerCount,
    });

    // Late joiner: if we're already in the submitting phase, send them the prompt
    if (room.phase === "submitting" && room.prompt) {
      socket.emit("room:prompt", { prompt: room.prompt });
    }
  });

  socket.on("player:submit", ({ roomCode, text }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    if (room.phase !== "submitting") {
      socket.emit("error:not-submitting", {
        message: "Room is not accepting submissions right now",
      });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player) return;

    if (player.submission) {
      socket.emit("error:already-submitted", {
        message: "You already submitted for this round",
      });
      return;
    }

    player.submission = text;

    // Count how many have submitted
    let submissionCount = 0;
    for (const [, p] of room.players) {
      if (p.submission) submissionCount++;
    }

    console.log(
      `[room ${roomCode}] ${player.name} submitted (${submissionCount}/${room.players.size})`
    );
    io.to(roomCode).emit("room:submission", {
      playerName: player.name,
      submissionCount,
    });
  });

  // -----------------------------------------------------------------------
  // DISCONNECT
  // -----------------------------------------------------------------------

  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);

    const roomCode = socketRoomMap.get(socket.id);
    if (!roomCode) return;

    socketRoomMap.delete(socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    room.players.delete(socket.id);

    const playerCount = room.players.size;

    if (player) {
      console.log(
        `[room ${roomCode}] ${player.name} disconnected (${playerCount} remaining)`
      );
      io.to(roomCode).emit("room:player-left", {
        playerName: player.name,
        playerCount,
      });
    }

    // If the host disconnected and no players remain, clean up the room
    if (socket.id === room.hostSocketId && playerCount === 0) {
      rooms.delete(roomCode);
      console.log(`[room ${roomCode}] deleted (host left, no players)`);
    }
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log(`\n  Hot Take Arena server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}\n`);
});
