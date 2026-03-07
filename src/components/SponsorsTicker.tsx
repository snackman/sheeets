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
        <span key={i}>
          {i > 0 && <span className="mx-6 text-stone-600">&#10022;</span>}
          {s.beforeText} <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-slate-500 underline-offset-2 hover:text-stone-200 hover:decoration-slate-300 transition-colors"
          >{s.linkText}</a>{s.afterText}
        </span>
      ))}
      <span className="mx-6 text-stone-600">&#10022;</span>
    </span>
  );

  return (
    <div className="w-full overflow-hidden bg-stone-950/80 border-b border-stone-800/50 py-1.5">
      <div className="sponsors-scroll inline-flex whitespace-nowrap text-xs text-stone-400">
        {item}{item}{item}{item}{item}{item}{item}{item}
      </div>
    </div>
  );
}
