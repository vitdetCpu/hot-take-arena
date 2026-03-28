import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { judgeSubmissions } from "./minimax.js";
import { transcribeAudio } from "./transcribe.js";

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

// ---------------------------------------------------------------------------
// REST API: Speech-to-text via fal Whisper
// ---------------------------------------------------------------------------

// Simple per-IP rate limiter for transcription endpoint
const transcribeRateMap = new Map();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;

function checkTranscribeRate(ip) {
  const now = Date.now();
  const entry = transcribeRateMap.get(ip) || { count: 0, reset: now + RATE_LIMIT_WINDOW };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + RATE_LIMIT_WINDOW;
  }
  entry.count++;
  transcribeRateMap.set(ip, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

// Accept raw audio body (up to 10MB)
app.post("/api/transcribe", express.raw({ type: "audio/*", limit: "10mb" }), async (req, res) => {
  try {
    if (!checkTranscribeRate(req.ip)) {
      return res.status(429).json({ error: "Too many requests. Try again in a minute." });
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: "No audio data received" });
    }

    const text = await transcribeAudio(req.body, req.headers["content-type"] || "audio/webm");
    res.json({ text });
  } catch (err) {
    console.error("[transcribe] error:", err.message);
    res.status(500).json({ error: "Transcription failed. Please try again." });
  }
});

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

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS_PER_ROOM = 150;

// Clean up stale rate-limit entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of transcribeRateMap) {
    if (now > entry.reset) transcribeRateMap.delete(ip);
  }
}, 60_000);

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
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.phase !== "lobby") return;

    // Validate prompt
    const safePrompt = typeof prompt === "string" ? prompt.trim().slice(0, 500) : "";
    if (!safePrompt) return;

    room.prompt = safePrompt;
    room.phase = "submitting";
    console.log(`[room ${roomCode}] prompt set, phase → submitting`);
    io.to(roomCode).emit("room:prompt", { prompt: safePrompt });
  });

  socket.on("host:start-judging", async ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.phase !== "submitting") return;

    room.phase = "judging";
    console.log(`[room ${roomCode}] phase → judging`);

    // Build submissions array with socketId for player identification
    const submissions = [];
    let idx = 1;
    for (const [socketId, player] of room.players) {
      if (player.submission && player.connected !== false) {
        submissions.push({
          index: idx,
          playerName: player.name,
          text: player.submission,
          socketId,
        });
        idx++;
      }
    }

    if (submissions.length === 0) {
      room.phase = "results";
      io.to(roomCode).emit("room:judging-complete", { totalResults: 0 });
      return;
    }

    // Abort guard: prevents ghost results from arriving after timeout/error
    let aborted = false;
    const safeOnRoast = (roast) => {
      if (aborted) return;
      room.results.push(roast);
      io.to(roomCode).emit("room:roast", roast);
    };

    const timeoutId = setTimeout(() => { aborted = true; }, 90_000);

    try {
      // Race against a 90s timeout to prevent indefinite hangs
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AI judging timed out after 90s")), 90_000)
      );
      const results = await Promise.race([
        judgeSubmissions(room.prompt, submissions, safeOnRoast),
        timeoutPromise,
      ]);

      clearTimeout(timeoutId);

      room.phase = "results";
      console.log(
        `[room ${roomCode}] judging complete, ${results.length} roasts`
      );
      io.to(roomCode).emit("room:judging-complete", {
        totalResults: results.length,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      aborted = true;

      console.error(`[room ${roomCode}] judging error:`, err.message);

      // If we got partial results, still show them
      if (room.results.length > 0) {
        room.phase = "results";
        console.log(
          `[room ${roomCode}] partial results: ${room.results.length} roasts delivered before error`
        );
        io.to(roomCode).emit("room:judging-complete", {
          totalResults: room.results.length,
        });
      } else {
        // No results at all — transition back to submitting so host can retry
        room.phase = "submitting";
        io.to(roomCode).emit("room:judging-error", {
          message: "AI judging failed. Please retry.",
        });
      }
    }
  });

  socket.on("host:next-round", ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.hostSocketId !== socket.id) return;

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

    // Server-side name validation
    const name =
      typeof playerName === "string" ? playerName.trim().slice(0, 30) : "Anon";
    const safeName = name || "Anon";

    // Player cap check
    const connectedPlayerCount = [...room.players.values()].filter((p) => p.connected !== false).length;
    if (connectedPlayerCount >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("error:room-not-found", {
        message: "Room is full",
      });
      return;
    }

    // Check for reconnection or name conflict
    let existingSubmission = null;
    for (const [existingId, player] of room.players) {
      if (player.name === safeName) {
        // If the old socket is still connected, reject the duplicate name
        const existingSocket = io.sockets.sockets.get(existingId);
        if (existingSocket && existingSocket.connected) {
          socket.emit("error:name-taken", {
            message: `Name "${safeName}" is already taken in this room`,
          });
          return;
        }
        // Old socket is disconnected — restore their submission (reconnect)
        existingSubmission = player.submission;
        room.players.delete(existingId);
        socketRoomMap.delete(existingId);
        break;
      }
    }

    room.players.set(socket.id, {
      name: safeName,
      submission: existingSubmission,
      connected: true,
    });
    socket.join(code);
    socketRoomMap.set(socket.id, code);

    const playerCount = [...room.players.values()].filter((p) => p.connected !== false).length;
    console.log(`[room ${code}] ${name} joined (${playerCount} players)`);
    io.to(code).emit("room:player-joined", {
      playerName: name,
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

    // Server-side validation (client enforces 280, but validate here too)
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed || trimmed.length > 500) {
      socket.emit("error:invalid-submission", {
        message: "Submission must be 1-500 characters",
      });
      return;
    }

    player.submission = trimmed;

    // Count how many connected players have submitted
    let submissionCount = 0;
    let connectedCount = 0;
    for (const [, p] of room.players) {
      if (p.connected !== false) {
        connectedCount++;
        if (p.submission) submissionCount++;
      }
    }

    console.log(
      `[room ${roomCode}] ${player.name} submitted (${submissionCount}/${connectedCount})`
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

    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);

    if (player) {
      // Mark as disconnected instead of deleting — allows reconnection
      player.connected = false;
      player.disconnectedAt = Date.now();

      // Clean up after 60s if not reconnected
      setTimeout(() => {
        const p = room.players.get(socket.id);
        if (p && !p.connected) {
          room.players.delete(socket.id);
          socketRoomMap.delete(socket.id);
        }
      }, 60_000);

      const connectedCount = [...room.players.values()].filter((p) => p.connected !== false).length;
      console.log(
        `[room ${roomCode}] ${player.name} disconnected (${connectedCount} connected)`
      );
      io.to(roomCode).emit("room:player-left", {
        playerName: player.name,
        playerCount: connectedCount,
      });
    }

    // If the host disconnected, notify remaining players
    if (socket.id === room.hostSocketId) {
      const connectedCount = [...room.players.values()].filter((p) => p.connected !== false).length;
      if (connectedCount === 0) {
        rooms.delete(roomCode);
        console.log(`[room ${roomCode}] deleted (host left, no players)`);
      } else {
        io.to(roomCode).emit("room:host-disconnected");
        console.log(
          `[room ${roomCode}] host disconnected, ${connectedCount} players notified`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  const localIP = getLocalIP();
  console.log(`\n  Hot Take Arena server running!\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}\n`);
});
