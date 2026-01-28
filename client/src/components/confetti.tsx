import { useEffect, useState } from 'react';

interface ConfettiProps {
  active: boolean;
  duration?: number;
}

export function Confetti({ active, duration = 3000 }: ConfettiProps) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; delay: number; color: string }>>([]);

  useEffect(() => {
    if (active) {
      const colors = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];
      const newParticles = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 500,
        color: colors[Math.floor(Math.random() * colors.length)],
      }));
      setParticles(newParticles);

      const timer = setTimeout(() => setParticles([]), duration);
      return () => clearTimeout(timer);
    }
  }, [active, duration]);

  if (!active || particles.length === 0) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((particle) => (
        <div
          key={particle.id}
          className="absolute w-2 h-2 rounded-full animate-bounce"
          style={{
            left: `${particle.x}%`,
            top: '-10px',
            backgroundColor: particle.color,
            animationDelay: `${particle.delay}ms`,
            animationDuration: '1s',
          }}
        />
      ))}
    </div>
  );
}
