import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { QRCode } from 'react-qrcode-logo';
import RevealCard from '../components/RevealCard';

const PROMPT_SUGGESTIONS = [
  "What's the worst dating advice you've ever received?",
  'Convince me you deserve a raise in one sentence',
  "What's your most controversial food opinion?",
  'Describe your coding style like a Tinder bio',
  'What would your TED talk be about?',
];

export default function HostView() {
  // ---------------------------------------------------------------------------
  // Socket & room state
  // ---------------------------------------------------------------------------
  const socketRef = useRef(null);
  const [roomCode, setRoomCode] = useState(null);
  const [localIP, setLocalIP] = useState(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [playerCountKey, setPlayerCountKey] = useState(0); // for pop animation

  // ---------------------------------------------------------------------------
  // Phase state machine: lobby → submitting → judging → results
  // ---------------------------------------------------------------------------
  const [phase, setPhase] = useState('lobby');

  // Lobby
  const [promptText, setPromptText] = useState('');

  // Submitting
  const [submissionCount, setSubmissionCount] = useState(0);
  const [recentSubmissions, setRecentSubmissions] = useState([]); // ticker items
  const tickerIdRef = useRef(0);

  // Results
  const [results, setResults] = useState([]);
  const [judgingComplete, setJudgingComplete] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState(-1);
  const [showShake, setShowShake] = useState(false);
  const [judgingError, setJudgingError] = useState(null);

  // ---------------------------------------------------------------------------
  // Socket.IO setup
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    // Auto-create room on mount
    socket.emit('host:create-room');

    socket.on('room:created', ({ roomCode: code, localIP: ip }) => {
      setRoomCode(code);
      setLocalIP(ip);
    });

    socket.on('room:player-joined', ({ playerName, playerCount: count }) => {
      setPlayerCount(count);
      setPlayerCountKey((k) => k + 1);
    });

    socket.on('room:player-left', ({ playerName, playerCount: count }) => {
      setPlayerCount(count);
      setPlayerCountKey((k) => k + 1);
    });

    socket.on('room:submission', ({ playerName, submissionCount: count }) => {
      setSubmissionCount(count);
      // Add to ticker
      tickerIdRef.current += 1;
      const tickerId = tickerIdRef.current;
      setRecentSubmissions((prev) => [...prev.slice(-4), { id: tickerId, name: playerName }]);
    });

    socket.on('room:roast', (roast) => {
      setPhase('results');
      setResults((prev) => {
        const next = [...prev, roast];
        return next.sort((a, b) => a.score - b.score);
      });
    });

    socket.on('room:judging-complete', ({ totalResults }) => {
      setJudgingComplete(true);
    });

    socket.on('room:judging-error', ({ message }) => {
      setJudgingError(message || 'AI judging failed');
      setPhase('submitting'); // Go back so host can retry
    });

    socket.on('room:reset', () => {
      setPhase('lobby');
      setPromptText('');
      setSubmissionCount(0);
      setRecentSubmissions([]);
      setResults([]);
      setJudgingComplete(false);
      setWinnerIndex(-1);
      setShowShake(false);
      setJudgingError(null);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Determine winner when judging completes
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (judgingComplete && results.length > 0) {
      // Find highest score
      let maxScore = -1;
      let maxIdx = -1;
      results.forEach((r, i) => {
        if (r.score > maxScore) {
          maxScore = r.score;
          maxIdx = i;
        }
      });
      setWinnerIndex(maxIdx);
      setShowShake(true);
      // Remove shake after animation
      const timer = setTimeout(() => setShowShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [judgingComplete, results]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const handlePushPrompt = useCallback(() => {
    if (!promptText.trim() || !roomCode) return;
    socketRef.current?.emit('host:push-prompt', {
      roomCode,
      prompt: promptText.trim(),
    });
    setPhase('submitting');
    setSubmissionCount(0);
    setRecentSubmissions([]);
  }, [promptText, roomCode]);

  const handleStartJudging = useCallback(() => {
    if (!roomCode) return;
    socketRef.current?.emit('host:start-judging', { roomCode });
    setPhase('judging');
    setResults([]);
    setJudgingComplete(false);
    setWinnerIndex(-1);
    setJudgingError(null);
  }, [roomCode]);

  const handleNextRound = useCallback(() => {
    if (!roomCode) return;
    socketRef.current?.emit('host:next-round', { roomCode });
  }, [roomCode]);

  // ---------------------------------------------------------------------------
  // Build the join URL for the QR code
  // ---------------------------------------------------------------------------
  // Use the host's current port — in dev that's 5173 (Vite), in production
  // that's 3001 (Express). Players need the same port to reach the frontend.
  const portSuffix = window.location.port ? `:${window.location.port}` : '';
  const joinUrl = localIP && roomCode
    ? `http://${localIP}${portSuffix}/play?room=${roomCode}`
    : '';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className={`min-h-screen bg-[#0a0a0f] text-[#e2e8f0] flex flex-col items-center justify-center p-6 md:p-10 ${
        showShake ? 'animate-shake' : ''
      }`}
    >
      {/* ================================================================= */}
      {/* LOBBY PHASE                                                       */}
      {/* ================================================================= */}
      {phase === 'lobby' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-6 w-full max-w-3xl">
          {/* Title */}
          <h1 className="text-3xl md:text-4xl font-bold text-gradient-purple-pink tracking-tight">
            Hot Take Arena
          </h1>

          {/* QR Code + Room Code */}
          <div className="flex flex-col items-center gap-4">
            {joinUrl && (
              <div className="glass-card p-4 rounded-2xl">
                <QRCode
                  value={joinUrl}
                  size={280}
                  bgColor="#0a0a0f"
                  fgColor="#ffffff"
                  qrStyle="dots"
                  eyeRadius={8}
                />
              </div>
            )}

            {roomCode && (
              <div
                className="font-bold tracking-[0.3em] text-gradient-purple-pink select-all"
                style={{ fontSize: 'clamp(4rem, 10vw, 8rem)', lineHeight: 1.1 }}
              >
                {roomCode}
              </div>
            )}

            <p className="text-[#94a3b8] text-lg">
              Scan the QR code or go to <span className="text-[#22d3ee] font-mono">/play</span> and
              enter the code
            </p>
          </div>

          {/* Player count */}
          <div className="flex items-center gap-3">
            <span className="text-[#94a3b8] text-xl">Players:</span>
            <span
              key={playerCountKey}
              className="animate-count-pop text-3xl font-bold text-[#22d3ee]"
            >
              {playerCount}
            </span>
          </div>

          {/* Prompt area */}
          <div className="w-full glass-card p-6 space-y-4">
            <label className="block text-lg font-semibold text-[#94a3b8]">
              Set the prompt
            </label>

            <input
              type="text"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-lg
                         text-[#e2e8f0] placeholder-[#94a3b8]/50 outline-none
                         focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-colors"
              placeholder="Type a prompt or pick one below..."
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePushPrompt();
              }}
            />

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2">
              {PROMPT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setPromptText(suggestion)}
                  className="px-3 py-2 text-sm rounded-lg bg-white/5 border border-white/10
                             text-[#94a3b8] hover:text-[#e2e8f0] hover:border-purple-500/30
                             hover:bg-purple-500/10 transition-colors cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {/* Lock & Go button */}
            <button
              onClick={handlePushPrompt}
              disabled={!promptText.trim()}
              className="btn-gradient w-full py-4 rounded-xl text-xl font-bold text-white
                         tracking-wider uppercase cursor-pointer"
            >
              Lock &amp; Go
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUBMITTING PHASE                                                  */}
      {/* ================================================================= */}
      {phase === 'submitting' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-6 w-full max-w-3xl">
          {/* Prompt display */}
          <div className="glass-card p-6 w-full text-center">
            <p className="text-[#94a3b8] text-base mb-2 uppercase tracking-wider font-semibold">
              The Prompt
            </p>
            <h2 className="text-2xl md:text-3xl font-bold text-[#e2e8f0] leading-snug">
              {promptText}
            </h2>
          </div>

          {/* Submission count */}
          <div className="flex items-center gap-4">
            <span className="text-[#94a3b8] text-xl">Submissions:</span>
            <span className="text-4xl font-bold text-[#22c55e]">
              {submissionCount}
            </span>
            <span className="text-[#94a3b8] text-xl">/</span>
            <span className="text-xl text-[#94a3b8]">{playerCount} players</span>
          </div>

          {/* Submission ticker */}
          <div className="h-10 relative overflow-hidden w-full max-w-md">
            {recentSubmissions.slice(-3).map((item) => (
              <div
                key={item.id}
                className="animate-ticker text-center text-lg text-[#a855f7] font-semibold absolute inset-x-0"
              >
                {item.name} submitted!
              </div>
            ))}
          </div>

          {/* Judge button */}
          <button
            onClick={handleStartJudging}
            disabled={submissionCount < 2}
            className={`btn-gradient px-12 py-5 rounded-xl text-2xl font-bold text-white
                       tracking-wider uppercase cursor-pointer
                       ${submissionCount >= 2 ? 'animate-pulse-glow' : ''}`}
          >
            Judge!
          </button>

          {judgingError && (
            <div className="glass-card p-4 border-red-500/30 border text-center animate-fade-in-up">
              <p className="text-red-400 font-semibold mb-1">Judging failed</p>
              <p className="text-[#94a3b8] text-sm">{judgingError}</p>
              <p className="text-[#94a3b8] text-xs mt-1">Hit JUDGE! to retry</p>
            </div>
          )}

          {submissionCount < 2 && !judgingError && (
            <p className="text-[#94a3b8] text-sm">Need at least 2 submissions to start judging</p>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* JUDGING PHASE                                                     */}
      {/* ================================================================= */}
      {phase === 'judging' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gradient-purple-pink">
            The judge is deliberating...
          </h2>

          {/* Animated spinner */}
          <div className="relative" style={{ width: '80px', height: '80px' }}>
            <div
              className="animate-spin-slow absolute inset-0 rounded-full"
              style={{
                border: '3px solid transparent',
                borderTopColor: '#a855f7',
                borderRightColor: '#ec4899',
              }}
            />
            <div
              className="animate-spin-slow absolute rounded-full"
              style={{
                inset: '8px',
                border: '3px solid transparent',
                borderBottomColor: '#22d3ee',
                borderLeftColor: '#22c55e',
                animationDirection: 'reverse',
                animationDuration: '1.5s',
              }}
            />
          </div>

          <p className="text-[#94a3b8] text-lg animate-float">
            Reviewing {submissionCount} hot takes...
          </p>
        </div>
      )}

      {/* ================================================================= */}
      {/* RESULTS PHASE                                                     */}
      {/* ================================================================= */}
      {phase === 'results' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-6 w-full max-w-3xl">
          {/* Header */}
          <h2 className="text-3xl md:text-4xl font-bold text-gradient-purple-pink">
            {judgingComplete ? 'The Verdict' : 'Revealing...'}
          </h2>

          {/* Prompt reminder */}
          <p className="text-[#94a3b8] text-base text-center">
            {promptText}
          </p>

          {/* Results list */}
          <div className="w-full space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {results.map((result, i) => (
              <RevealCard
                key={`${result.playerName}-${result.index}`}
                playerName={result.playerName}
                text={result.text || ''}
                roast={result.roast}
                score={result.score}
                index={i}
                isWinner={judgingComplete && i === winnerIndex}
                delay={i * 300}
              />
            ))}
          </div>

          {/* Waiting indicator while still judging */}
          {!judgingComplete && (
            <div className="flex items-center gap-3 text-[#94a3b8]">
              <div
                className="animate-spin-slow rounded-full"
                style={{
                  width: '20px',
                  height: '20px',
                  border: '2px solid transparent',
                  borderTopColor: '#a855f7',
                }}
              />
              <span>More results incoming...</span>
            </div>
          )}

          {/* Next round button */}
          {judgingComplete && (
            <button
              onClick={handleNextRound}
              className="btn-gradient px-10 py-4 rounded-xl text-xl font-bold text-white
                         tracking-wider uppercase cursor-pointer animate-fade-in-up mt-4"
            >
              Next Round
            </button>
          )}
        </div>
      )}
    </div>
  );
}
