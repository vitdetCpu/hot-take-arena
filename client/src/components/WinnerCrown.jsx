/**
 * WinnerCrown — Celebration animation with particle burst and crown.
 *
 * Renders a pulsing crown icon above the winner card, with 12 colored particles
 * that burst outward using CSS animations.
 */

const PARTICLE_COLORS = [
  '#a855f7', // purple
  '#ec4899', // pink
  '#22d3ee', // cyan
  '#22c55e', // green
  '#a855f7',
  '#ec4899',
  '#22d3ee',
  '#22c55e',
  '#a855f7',
  '#ec4899',
  '#22d3ee',
  '#22c55e',
];

/**
 * Generate the endpoint translate for each particle, evenly distributed
 * around a circle.
 */
function getParticleEndpoint(index, total) {
  const angle = (index / total) * 2 * Math.PI;
  const distance = 60 + Math.random() * 30; // 60-90px
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  return `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
}

export default function WinnerCrown({ visible }) {
  if (!visible) return null;

  return (
    <div className="flex justify-center items-center mb-2 relative" style={{ height: '60px' }}>
      {/* Glow backdrop */}
      <div
        className="absolute rounded-full"
        style={{
          width: '80px',
          height: '40px',
          background: 'radial-gradient(ellipse, rgba(168, 85, 247, 0.3), transparent)',
          filter: 'blur(10px)',
          top: '10px',
        }}
      />

      {/* Crown */}
      <div
        className="animate-crown-bounce relative z-10 select-none"
        style={{ fontSize: '2.5rem', lineHeight: 1 }}
        aria-hidden="true"
      >
        {/* Using a text crown character */}
        <span className="text-gradient-purple-pink" style={{ WebkitTextFillColor: '#fbbf24' }}>
          &#9812;
        </span>
      </div>

      {/* Particles */}
      {PARTICLE_COLORS.map((color, i) => (
        <div
          key={i}
          className="animate-particle-burst absolute rounded-full"
          style={{
            width: '8px',
            height: '8px',
            backgroundColor: color,
            top: '50%',
            left: '50%',
            marginTop: '-4px',
            marginLeft: '-4px',
            '--particle-end': getParticleEndpoint(i, PARTICLE_COLORS.length),
            animationDelay: `${i * 50}ms`,
          }}
        />
      ))}
    </div>
  );
}
