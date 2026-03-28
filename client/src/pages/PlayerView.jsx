import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';

const MAX_CHARS = 280;

export default function PlayerView() {
  const [searchParams] = useSearchParams();
  const socketRef = useRef(null);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const [phase, setPhase] = useState('joining'); // joining -> waiting -> submitting -> submitted -> results
  const [roomCode, setRoomCode] = useState(searchParams.get('room')?.toUpperCase() || '');
  const [playerName, setPlayerName] = useState('');
  const [joinedRoomCode, setJoinedRoomCode] = useState('');
  const [joinError, setJoinError] = useState('');

  // Submitting
  const [prompt, setPrompt] = useState('');
  const [hotTake, setHotTake] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Voice input (Web Speech API)
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);

  // Results
  const [myResult, setMyResult] = useState(null);
  const [totalResults, setTotalResults] = useState(0);
  const [allResults, setAllResults] = useState([]);

  // Computed: has room code from URL?
  const hasRoomFromUrl = Boolean(searchParams.get('room'));

  // Ref to track socket ID for matching roast results to this player
  const socketIdRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Socket.IO setup — single useEffect, all listeners use refs for state
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    // Capture socket ID for reliable player identification (handles duplicate names)
    socket.on('connect', () => {
      socketIdRef.current = socket.id;
    });

    socket.on('error:room-not-found', ({ message }) => {
      setJoinError(message || 'Room not found');
      setPhase('joining');
    });

    socket.on('error:already-submitted', ({ message }) => {
      setSubmitError(message || 'Already submitted');
    });

    socket.on('error:invalid-submission', ({ message }) => {
      setSubmitError(message || 'Invalid submission');
      setPhase('submitting');
    });

    socket.on('error:not-submitting', ({ message }) => {
      setSubmitError(message || 'Not accepting submissions');
    });

    socket.on('error:name-taken', ({ message }) => {
      setJoinError(message || 'Name already taken');
      setPhase('joining');
    });

    socket.on('room:player-joined', ({ playerName: name, playerCount }) => {
      // Check if this is our own join confirmation (server echoes to room)
      // We transition to waiting after emitting join — see handleJoin
    });

    socket.on('room:prompt', ({ prompt: p }) => {
      setPrompt(p);
      setPhase('submitting');
      setHotTake('');
      setSubmitError('');
    });

    socket.on('room:roast', (roast) => {
      setAllResults((prev) => [...prev, roast]);
      // Match on socket ID (reliable) — handles duplicate player names
      if (roast.socketId && roast.socketId === socketIdRef.current) {
        setMyResult(roast);
        setPhase('results');
      }
    });

    socket.on('room:judging-complete', ({ totalResults: total }) => {
      setTotalResults(total);
      // If we never got a personal result (didn't submit), still transition
      setPhase((prev) => (prev === 'submitted' || prev === 'submitting' ? 'results' : prev));
    });

    socket.on('room:host-disconnected', () => {
      setPhase((prev) => {
        socket._preDisconnectPhase = prev;
        return 'host-disconnected';
      });
    });

    socket.on('room:host-reconnected', () => {
      setPhase((prev) => {
        if (prev === 'host-disconnected') {
          return socket._preDisconnectPhase || 'waiting';
        }
        return prev;
      });
    });

    socket.on('room:judging-error', () => {
      // Go back to submitted/submitting state — host will retry
      setPhase((prev) => (prev === 'results' ? 'submitted' : prev));
    });

    socket.on('room:reset', () => {
      setPhase('waiting');
      setPrompt('');
      setHotTake('');
      setSubmitError('');
      setMyResult(null);
      setTotalResults(0);
      setAllResults([]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const handleJoin = useCallback(() => {
    const code = roomCode.trim().toUpperCase();
    const name = playerName.trim();
    if (!code || !name) return;
    setJoinError('');
    setJoinedRoomCode(code);
    socketRef.current?.emit('player:join', { roomCode: code, playerName: name });
    setPhase('waiting');
  }, [roomCode, playerName]);

  const handleSubmit = useCallback(() => {
    if (!hotTake.trim() || !joinedRoomCode) return;
    setSubmitError('');
    socketRef.current?.emit('player:submit', {
      roomCode: joinedRoomCode,
      text: hotTake.trim(),
    });
    setPhase('submitted');
  }, [hotTake, joinedRoomCode]);

  // ---------------------------------------------------------------------------
  // Voice input (Web Speech API — free, no API keys)
  // ---------------------------------------------------------------------------
  const handleMicToggle = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSubmitError('Voice input not supported on this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript || '';
      if (text) {
        setHotTake((prev) => {
          const combined = prev ? `${prev} ${text}` : text;
          return combined.slice(0, MAX_CHARS);
        });
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        setSubmitError('Voice input failed. Try again.');
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    try {
      recognition.start();
      setIsRecording(true);
    } catch {
      setSubmitError('Microphone access denied or unavailable');
    }
  }, [isRecording]);

  // ---------------------------------------------------------------------------
  // Character count color
  // ---------------------------------------------------------------------------
  const charCount = hotTake.length;
  const charColor =
    charCount > MAX_CHARS
      ? '#ef4444'
      : charCount > MAX_CHARS * 0.85
        ? '#eab308'
        : '#22c55e';

  // ---------------------------------------------------------------------------
  // Compute rank
  // ---------------------------------------------------------------------------
  const myRank = myResult
    ? allResults
        .slice()
        .sort((a, b) => b.score - a.score)
        .findIndex((r) => r.socketId === myResult.socketId) + 1
    : null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-[100dvh] bg-[#0a0a0f] text-[#e2e8f0] flex flex-col items-center justify-center p-4">
      {/* ================================================================= */}
      {/* JOINING PHASE                                                     */}
      {/* ================================================================= */}
      {phase === 'joining' && (
        <div className="animate-fade-in-up w-full max-w-sm flex flex-col items-center gap-5">
          <h1 className="text-3xl font-bold text-gradient-purple-pink tracking-tight text-center">
            Hot Take Arena
          </h1>

          <p className="text-[#94a3b8] text-center">
            Enter the game and prove your take is the hottest.
          </p>

          <div className="w-full space-y-4">
            {/* Room code input -- only show if not from URL */}
            {!hasRoomFromUrl && (
              <div>
                <label className="block text-sm text-[#94a3b8] mb-1 font-medium">
                  Room Code
                </label>
                <input
                  type="text"
                  maxLength={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3
                             text-2xl font-bold tracking-[0.3em] text-center text-[#e2e8f0]
                             placeholder-[#94a3b8]/50 uppercase outline-none
                             focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30
                             transition-colors"
                  placeholder="ABCD"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase().slice(0, 4))}
                />
              </div>
            )}

            {/* If from URL, show room code display */}
            {hasRoomFromUrl && roomCode && (
              <div className="text-center">
                <span className="text-sm text-[#94a3b8]">Room</span>
                <div className="text-3xl font-bold text-[#22d3ee] tracking-[0.2em]">
                  {roomCode}
                </div>
              </div>
            )}

            {/* Name input */}
            <div>
              <label className="block text-sm text-[#94a3b8] mb-1 font-medium">
                Your Name
              </label>
              <input
                type="text"
                maxLength={20}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3
                           text-lg text-[#e2e8f0] placeholder-[#94a3b8]/50 outline-none
                           focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30
                           transition-colors"
                placeholder="Enter your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJoin();
                }}
              />
            </div>

            {/* Error */}
            {joinError && (
              <p className="text-red-400 text-sm text-center animate-fade-in-up">{joinError}</p>
            )}

            {/* Join button */}
            <button
              onClick={handleJoin}
              disabled={!roomCode.trim() || !playerName.trim()}
              className="btn-gradient w-full py-4 rounded-xl text-lg font-bold text-white
                         uppercase tracking-wider cursor-pointer"
              style={{ minHeight: '52px' }}
            >
              Join
            </button>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* WAITING PHASE                                                     */}
      {/* ================================================================= */}
      {phase === 'waiting' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-5 text-center">
          <div className="animate-float">
            <div
              className="text-6xl font-bold text-gradient-purple-pink"
              style={{ lineHeight: 1 }}
              aria-hidden="true"
            >
              ?
            </div>
          </div>

          <h2 className="text-xl font-bold text-[#e2e8f0]">
            Waiting for the host...
          </h2>

          <p className="text-[#94a3b8]">
            You&apos;re in! Sit tight, <span className="text-[#22d3ee] font-semibold">{playerName}</span>.
          </p>

          <div className="glass-card px-4 py-2 text-sm text-[#94a3b8]">
            Room: <span className="text-[#a855f7] font-bold tracking-wider">{joinedRoomCode}</span>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUBMITTING PHASE                                                  */}
      {/* ================================================================= */}
      {phase === 'submitting' && (
        <div className="animate-fade-in-up w-full max-w-sm flex flex-col gap-5">
          {/* Prompt */}
          <div className="glass-card p-4 text-center">
            <p className="text-xs text-[#94a3b8] uppercase tracking-wider font-semibold mb-1">
              The Prompt
            </p>
            <h2 className="text-lg font-bold text-[#e2e8f0] leading-snug">
              {prompt}
            </h2>
          </div>

          {/* Textarea + Mic */}
          <div className="relative">
            <textarea
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-14
                         text-base text-[#e2e8f0] placeholder-[#94a3b8]/50 outline-none
                         focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30
                         transition-colors resize-none"
              rows={4}
              maxLength={MAX_CHARS + 20}
              placeholder="Drop your hottest take..."
              value={hotTake}
              onChange={(e) => setHotTake(e.target.value)}
            />

            {/* Mic button */}
            <button
              type="button"
              onClick={handleMicToggle}
              className={`absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center
                         transition-all duration-200 cursor-pointer
                         ${isRecording
                           ? 'bg-red-500/20 border-2 border-red-500 animate-pulse-glow'
                           : 'bg-white/5 border border-white/20 hover:border-purple-500/40 hover:bg-purple-500/10'
                         }`}
              aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
            >
              <svg className={`w-5 h-5 ${isRecording ? 'text-red-400' : 'text-[#94a3b8]'}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </button>

            {/* Recording indicator */}
            {isRecording && (
              <div className="absolute -top-7 right-0 text-xs text-red-400 font-semibold animate-fade-in-up">
                Listening...
              </div>
            )}

            <div
              className="absolute bottom-3 right-3 text-xs font-mono font-bold"
              style={{ color: charColor }}
            >
              {charCount}/{MAX_CHARS}
            </div>
          </div>

          {/* Error */}
          {submitError && (
            <p className="text-red-400 text-sm text-center animate-fade-in-up">{submitError}</p>
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!hotTake.trim() || charCount > MAX_CHARS}
            className="btn-gradient w-full py-4 rounded-xl text-lg font-bold text-white
                       uppercase tracking-wider cursor-pointer"
            style={{ minHeight: '52px' }}
          >
            Submit
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUBMITTED PHASE                                                   */}
      {/* ================================================================= */}
      {phase === 'submitted' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-5 text-center">
          {/* Lock icon */}
          <div className="animate-scale-in">
            <div
              className="w-16 h-16 rounded-full bg-[#22c55e]/15 border-2 border-[#22c55e]/40
                         flex items-center justify-center"
            >
              <svg
                className="w-8 h-8 text-[#22c55e]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            </div>
          </div>

          <h2 className="text-xl font-bold text-[#22c55e]">Locked In!</h2>
          <p className="text-[#94a3b8] animate-float">
            Waiting for the judge...
          </p>
        </div>
      )}

      {/* ================================================================= */}
      {/* RESULTS PHASE                                                     */}
      {/* ================================================================= */}
      {phase === 'results' && (
        <div className="animate-fade-in-up w-full max-w-sm flex flex-col items-center gap-5 text-center">
          <h2 className="text-2xl font-bold text-gradient-purple-pink">
            Your Verdict
          </h2>

          {myResult ? (
            <>
              {/* Score */}
              <div className="animate-scale-in">
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center font-bold
                             border-2"
                  style={{
                    fontSize: '2.5rem',
                    color:
                      myResult.score <= 3
                        ? '#ef4444'
                        : myResult.score <= 6
                          ? '#eab308'
                          : myResult.score <= 8
                            ? '#22c55e'
                            : '#22d3ee',
                    borderColor:
                      myResult.score <= 3
                        ? '#ef4444'
                        : myResult.score <= 6
                          ? '#eab308'
                          : myResult.score <= 8
                            ? '#22c55e'
                            : '#22d3ee',
                    background:
                      myResult.score <= 3
                        ? 'rgba(239,68,68,0.12)'
                        : myResult.score <= 6
                          ? 'rgba(234,179,8,0.12)'
                          : myResult.score <= 8
                            ? 'rgba(34,197,94,0.12)'
                            : 'rgba(34,211,238,0.12)',
                  }}
                >
                  {myResult.score}
                </div>
              </div>

              {/* Roast */}
              <div className="glass-card p-4 w-full">
                <p className="text-base text-[#e2e8f0] leading-relaxed">
                  {myResult.roast}
                </p>
              </div>

              {/* Rank */}
              {myRank && (
                <p className="text-[#94a3b8] text-sm">
                  You placed{' '}
                  <span className="text-[#a855f7] font-bold">#{myRank}</span>
                  {totalResults > 0 && (
                    <> out of <span className="font-bold text-[#e2e8f0]">{totalResults}</span></>
                  )}
                  !
                </p>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                className="animate-spin-slow rounded-full"
                style={{
                  width: '32px',
                  height: '32px',
                  border: '3px solid transparent',
                  borderTopColor: '#a855f7',
                }}
              />
              <p className="text-[#94a3b8]">Waiting for your result...</p>
            </div>
          )}

          <p className="text-[#94a3b8] text-xs mt-2">
            Next round starts when the host is ready.
          </p>
        </div>
      )}

      {/* ================================================================= */}
      {/* HOST DISCONNECTED                                                 */}
      {/* ================================================================= */}
      {phase === 'host-disconnected' && (
        <div className="animate-fade-in-up flex flex-col items-center gap-4 text-center">
          <div className="text-4xl" aria-hidden="true">
            <svg className="w-12 h-12 text-red-400 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-red-400">Host Disconnected</h2>
          <p className="text-[#94a3b8]">The host has left the game. Thanks for playing!</p>
        </div>
      )}
    </div>
  );
}
