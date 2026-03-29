# Hot Take Arena

Real-time multiplayer opinion battle game. One person hosts on a big screen, everyone else joins on their phones. Submit hot takes to a prompt, then an AI judge roasts and scores every submission with a dramatic streaming reveal.

## How It Works

1. Host creates a room and projects the screen
2. Players scan the QR code to join on their phones
3. Host picks a prompt (e.g. "What's your most controversial food opinion?")
4. Everyone submits their hot take
5. AI reads every submission, roasts each one, and scores them 1-10
6. Results reveal one by one, lowest to highest, building up to the winner

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4
- **Backend:** Express, Socket.IO
- **AI Judge:** MiniMax M2 (streaming, parallel batched)

## Setup

```bash
npm install
cp .env.example .env
```

Add your API keys to `.env`:

```
MINIMAX_API_KEY=your-key-here

```

Get your keys from:
- MiniMax: https://www.minimax.io

## Run

**Development** (hot reload):

```bash
npm run dev
```

**Production:**

```bash
npm run build
npm start
```

Then open `http://localhost:3001` on the host machine. Players join by scanning the QR code or entering the room code on their phones.

## Load Testing

Benchmark AI judging speed with simulated submissions:

```bash
node server/load-test.js 100
```

## Architecture

```
client/          React frontend (Vite)
  src/
    pages/
      HostView   Projector screen with QR code, prompt, results reveal
      PlayerView Mobile view for joining and submitting
    components/
      RevealCard Score-colored result cards with roast text
      WinnerCrown Confetti animation for the winner
server/
  index.js       Express + Socket.IO server, room management
  minimax.js     AI judge with parallel batched streaming

```

### How AI Judging Works

Submissions are split into batches of 25 and sent to MiniMax M2 in parallel (up to 6 concurrent API calls). Results stream back as JSON objects are parsed from the response, so roast cards start appearing on screen within seconds. The system handles partial failures gracefully: if some batches fail, results from successful batches are still shown.

### Scale

- Up to 150 players per room
- 100 submissions judged in ~36 seconds (first roast appears in ~12s)
- Host reconnection with 30s grace period
- Player reconnection with 60s grace period

## License

MIT
