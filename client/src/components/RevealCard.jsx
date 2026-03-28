import WinnerCrown from './WinnerCrown';

/**
 * Score color based on value:
 * 0-3: red, 4-6: yellow, 7-8: green, 9-10: cyan/bright green
 */
function getScoreColor(score) {
  if (score <= 3) return '#ef4444';
  if (score <= 6) return '#eab308';
  if (score <= 8) return '#22c55e';
  return '#22d3ee';
}

/**
 * Score background glow based on value
 */
function getScoreBg(score) {
  if (score <= 3) return 'rgba(239, 68, 68, 0.15)';
  if (score <= 6) return 'rgba(234, 179, 8, 0.15)';
  if (score <= 8) return 'rgba(34, 197, 94, 0.15)';
  return 'rgba(34, 211, 238, 0.15)';
}

export default function RevealCard({
  playerName,
  text,
  roast,
  score,
  index,
  isWinner,
  delay = 0,
}) {
  const scoreColor = getScoreColor(score);
  const scoreBg = getScoreBg(score);

  return (
    <div className="relative">
      {isWinner && <WinnerCrown visible={true} />}
      <div
        className={`
          animate-slide-in-right glass-card p-5 md:p-6
          ${isWinner
            ? 'animate-pulse-glow border-2 border-purple-500/60 scale-105 ring-2 ring-pink-500/30'
            : ''
          }
          transition-transform duration-300
        `}
        style={{
          animationDelay: `${delay}ms`,
          animationFillMode: 'both',
        }}
      >
        <div className="flex items-start gap-4">
          {/* Score circle */}
          <div
            className="shrink-0 flex items-center justify-center rounded-full font-bold"
            style={{
              width: '56px',
              height: '56px',
              fontSize: '1.5rem',
              color: scoreColor,
              background: scoreBg,
              border: `2px solid ${scoreColor}`,
            }}
          >
            {score}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Player name */}
            <h3
              className={`
                font-bold text-lg md:text-xl mb-1
                ${isWinner ? 'text-gradient-purple-pink' : 'text-[#e2e8f0]'}
              `}
            >
              {playerName}
              {isWinner && (
                <span className="ml-2 text-sm font-normal text-[#22d3ee]">
                  WINNER
                </span>
              )}
            </h3>

            {/* Their hot take */}
            <p className="text-sm md:text-base text-[#94a3b8] italic mb-2 leading-relaxed">
              &ldquo;{text}&rdquo;
            </p>

            {/* The roast */}
            <p className="text-sm md:text-base text-[#e2e8f0] leading-relaxed">
              {roast}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
