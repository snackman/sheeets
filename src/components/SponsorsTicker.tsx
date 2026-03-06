import { SponsorEntry } from '@/lib/types';

const defaultSponsors: SponsorEntry[] = [
  {
    beforeText: 'Supported by ',
    linkText: 'Stand With Crypto',
    afterText: '. Join the Fight for Sensible Crypto Policy!',
    url: 'https://www.standwithcrypto.org/join/BtPHAB2fFkJP?utm_source=swc-hub&utm_medium=referral&utm_campaign=eth-denver-2026',
  },
];

interface SponsorsTickerProps {
  sponsors?: SponsorEntry[];
}

export function SponsorsTicker({ sponsors }: SponsorsTickerProps) {
  const sponsorList = sponsors && sponsors.length > 0 ? sponsors : defaultSponsors;

  const item = (
    <span className="inline-flex items-center">
      {sponsorList.map((s, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 && <span className="mx-6 text-slate-600">&#10022;</span>}
          <span>{s.beforeText}</span>
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-slate-500 underline-offset-2 hover:text-slate-200 hover:decoration-slate-300 transition-colors"
          >
            {s.linkText}
          </a>
          <span>{s.afterText}</span>
        </span>
      ))}
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
