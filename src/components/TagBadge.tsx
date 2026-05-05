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
  BadgeDollarSign,
  CircuitBoard,
  Globe,
  Presentation,
  Music,
  Sparkles,
  BookOpen,
  Star,
  Zap,
  Armchair,
  GalleryHorizontalEnd,
  Clapperboard,
  Projector,
  Sparkle,
  Laugh,
  Rocket,
  type LucideIcon,
} from 'lucide-react';
import { VIBE_COLORS } from '@/lib/constants';

/** Custom crypto logo SVG icons matching LucideIcon interface */
function EthIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 2L5.5 13 12 22l6.5-9z" />
      <path d="M5.5 13L12 10.5 18.5 13" />
    </svg>
  );
}

function BtcIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <g transform="rotate(14, 12, 12)">
        <path d="M9 4v2.5M13 4v2.5M9 17.5v2.5M13 17.5v2.5" />
        <path d="M7 6.5h6.5a3 3 0 0 1 0 5.5H7V6.5z" />
        <path d="M7 12h7a3 3 0 0 1 0 5.5H7V12z" />
      </g>
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
  'Free': BadgeDollarSign,
  'Conference': IdCardLanyard,
  'Panel/Talk': Mic,
  'Hackathon': Trophy,
  'Networking': Handshake,
  'Devs': Wrench,
  'VCs': CircleDollarSign,
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
  'Jobs': Briefcase,
  'Founders': Rocket,
  'Memecoins': Smile,
  'Party': PartyPopper,
  'Workshop': GraduationCap,
  'Meetup': Handshake,
  'Demo Day': Play,
  'Demo': Play,
  'Dinner': UtensilsCrossed,
  'Performance': Drama,
  'Tech': CircuitBoard,
  'Culture': Globe,
  'Session': Presentation,
  'Music': Music,
  'Showcase': Sparkles,
  'Education': BookOpen,
  'Special Event': Star,
  'Activation': Zap,
  'Lounge': Armchair,
  'Exhibition': GalleryHorizontalEnd,
  'Film/TV': Clapperboard,
  'Screening': Projector,
  'Vibe': Sparkle,
  'Food': UtensilsCrossed,
  'Drinks': Beer,
  'Comedy': Laugh,
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
      <span className="hidden sm:inline text-[var(--theme-text-secondary)]">{tag}</span>
    </span>
  );
}
