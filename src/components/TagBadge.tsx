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
  Ticket,
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
  // Official Solana logo paths scaled to fit, using currentColor
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 397.7 311.7" fill="currentColor" stroke="none" {...props}>
      <path d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z" />
      <path d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z" />
      <path d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z" />
    </svg>
  );
}

type IconComponent = LucideIcon | ((props: React.SVGProps<SVGSVGElement>) => React.ReactNode);

export const TAG_ICONS: Record<string, IconComponent> = {
  '$$': Ticket,
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
  iconClassName?: string;
}

export function TagBadge({ tag, size = 'sm', iconOnly = false, iconClassName }: TagBadgeProps) {
  const Icon = TAG_ICONS[tag];
  const color = VIBE_COLORS[tag] || VIBE_COLORS['default'];
  const iconSize = iconClassName
    ? iconClassName
    : iconOnly
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
