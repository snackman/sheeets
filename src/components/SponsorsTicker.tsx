const sponsors = [
  {
    name: 'Stand With Crypto',
    url: 'https://www.standwithcrypto.org/join/BtPHAB2fFkJP?utm_source=swc-hub&utm_medium=referral&utm_campaign=eth-denver-2026',
  },
];

export function SponsorsTicker() {
  const text = 'Supported by ';

  const renderSponsors = () =>
    sponsors.map((s, i) => (
      <span key={i}>
        {i > 0 && ', '}
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-slate-500 underline-offset-2 hover:text-slate-200 hover:decoration-slate-300 transition-colors"
        >
          {s.name}
        </a>
      </span>
    ));

  const item = (
    <span className="inline-flex items-center">
      <span className="mr-1">{text}</span>
      {renderSponsors()}
      <span>. Join the Fight for Sensible Crypto Policy!</span>
      <span className="mx-6 text-slate-600">&#10022;</span>
    </span>
  );

  return (
    <div className="w-full overflow-hidden bg-slate-900/80 border-b border-slate-800/50 py-1.5">
      <div className="sponsors-scroll inline-flex whitespace-nowrap text-xs text-slate-400">
        {item}{item}{item}{item}{item}{item}{item}{item}
      </div>
    </div>
  );
}
