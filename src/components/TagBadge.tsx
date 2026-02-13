'use client';

import {
  Mic,
  Trophy,
  Handshake,
  Wrench,
  CircleDollarSign,
  Bot,
  ChartCandlestick,
  Image,
  Cpu,
  Gamepad2,
  Palette,
  Heart,
  Coffee,
  Beer,
  Briefcase,
  Smile,
  GraduationCap,
  Play,
  House,
  UtensilsCrossed,
  Drama,
  IdCardLanyard,
  Vote,
  PartyPopper,
  type LucideIcon,
} from 'lucide-react';
import { VIBE_COLORS } from '@/lib/constants';

/** Custom crypto logo SVG icons matching LucideIcon interface */
function EthIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 1.5l-7 10.17L12 15l7-3.33z" />
      <path d="M5 11.67L12 22.5l7-10.83L12 15z" />
    </svg>
  );
}

function BtcIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 5V3m4 2V3M9 21v-2m4 2v-2" />
      <path d="M7 7h7a3 3 0 010 6H7zm0 6h8a3 3 0 010 6H7z" />
    </svg>
  );
}

function SolIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 6h14l2 2H4z" />
      <path d="M4 16h14l2 2H4z" />
      <path d="M20 11H6l-2-2h16z" />
    </svg>
  );
}

function FreeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" {...props}>
      <path d="M100,20 C112,20 115,35 127,38 C139,41 150,32 159,41 C168,50 159,61 162,73 C165,85 180,88 180,100 C180,112 165,115 162,127 C159,139 168,150 159,159 C150,168 139,159 127,162 C115,165 112,180 100,180 C88,180 85,165 73,162 C61,159 50,168 41,159 C32,150 41,139 38,127 C35,115 20,112 20,100 C20,88 35,85 38,73 C41,61 32,50 41,41 C50,32 61,41 73,38 C85,35 88,20 100,20Z" />
      <text x="100" y="105" dominantBaseline="middle" textAnchor="middle" fontFamily="Arial Black, sans-serif" fontSize="40" fill="currentColor" stroke="none" transform="rotate(-30, 100, 105)">FREE</text>
    </svg>
  );
}

type IconComponent = LucideIcon | ((props: React.SVGProps<SVGSVGElement>) => React.ReactNode);

export const TAG_ICONS: Record<string, IconComponent> = {
  'FREE': FreeIcon,
  'Conference': IdCardLanyard,
  'Panel/Talk': Mic,
  'Hackathon': Trophy,
  'Networking': Handshake,
  'Devs/Builders': Wrench,
  'VCs/Angels': CircleDollarSign,
  'AI': Bot,
  'DeFi': ChartCandlestick,
  'DAOs': Vote,
  'NFTs': Image,
  'DePIN': Cpu,
  'RWA': House,
  'ETH': EthIcon,
  'BTC': BtcIcon,
  'SOL': SolIcon,
  'Gaming': Gamepad2,
  'Art': Palette,
  'Wellness': Heart,
  'Brunch': Coffee,
  'Bar/Pub': Beer,
  'Jobs/Hiring': Briefcase,
  'Memecoins': Smile,
  'Party': PartyPopper,
  'Workshop': GraduationCap,
  'Meetup': Handshake,
  'Demo Day': Play,
  'Demo': Play,
  'Dinner': UtensilsCrossed,
  'Performance': Drama,
};

interface TagBadgeProps {
  tag: string;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}

export function TagBadge({ tag, size = 'sm', iconOnly = false }: TagBadgeProps) {
  const Icon = TAG_ICONS[tag];
  const color = VIBE_COLORS[tag] || VIBE_COLORS['default'];
  const iconSize = iconOnly
    ? 'w-5 h-5'
    : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  if (iconOnly) {
    return Icon ? (
      <span title={tag} className="inline-flex items-center justify-center">
        <Icon className={`${iconSize} flex-shrink-0`} style={{ color }} />
      </span>
    ) : null;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium"
      title={tag}
    >
      {Icon && <Icon className={`${iconSize} flex-shrink-0`} style={{ color }} />}
      <span className="text-slate-300">{tag}</span>
    </span>
  );
}
