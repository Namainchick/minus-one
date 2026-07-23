export function Hero() {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-6xl uppercase leading-[0.95] tracking-tight sm:text-7xl">
          Minus
          <br />
          One
        </h1>
        <p className="mt-3 text-xs font-medium uppercase tracking-[0.3em]">
          Zerleg deinen Song · Schalte deine Band
        </p>
      </div>
      <div className="rotate-3 border-[3px] border-ink bg-poster-yellow px-3 py-1.5 text-[11px] font-bold uppercase shadow-poster">
        Built for my band
      </div>
    </header>
  );
}
