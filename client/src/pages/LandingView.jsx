import { useNavigate } from 'react-router-dom';

export default function LandingView() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0f] text-[#e2e8f0] flex flex-col items-center justify-center p-4 gap-8">
      <div className="animate-fade-in-up text-center space-y-3">
        <h1 className="text-5xl font-bold text-gradient-purple-pink tracking-tight">
          Hot Take Arena
        </h1>
        <p className="text-[#94a3b8] text-lg">
          Submit your hottest takes. Get roasted by AI.
        </p>
      </div>

      <div className="animate-fade-in-up flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={() => navigate('/host')}
          className="btn-gradient w-full py-4 rounded-xl text-lg font-bold text-white
                     uppercase tracking-wider cursor-pointer"
          aria-label="Host a new game"
        >
          Host a Game
        </button>

        <button
          onClick={() => navigate('/play')}
          className="w-full py-4 rounded-xl text-lg font-bold text-[#e2e8f0]
                     uppercase tracking-wider cursor-pointer
                     bg-white/5 border border-white/10
                     hover:border-purple-500/30 hover:bg-purple-500/10 transition-colors"
          aria-label="Join an existing game as a player"
        >
          Join a Game
        </button>
      </div>
    </div>
  );
}
