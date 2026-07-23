type Props = {
  title: string;
  text: string;
  onRetry?: () => void;
  onDemo: () => void;
};

export function PosterBox({ title, text, onRetry, onDemo }: Props) {
  return (
    <div role="alert" className="border-[3px] border-ink bg-white p-5 shadow-poster-lg">
      <h2 className="font-display text-2xl uppercase">{title}</h2>
      <p className="mt-2 text-sm">{text}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="border-[3px] border-ink bg-white px-4 py-2 text-sm font-bold uppercase shadow-poster transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none"
          >
            Nochmal versuchen
          </button>
        )}
        <button
          onClick={onDemo}
          className="border-[3px] border-ink bg-poster-red px-4 py-2 text-sm font-bold uppercase text-white shadow-poster transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          Demo-Song laden
        </button>
      </div>
    </div>
  );
}
