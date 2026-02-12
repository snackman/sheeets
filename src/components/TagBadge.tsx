'use client';

import {
  Landmark,
  Mic,
  Code,
  Users,
  Wrench,
  TrendingUp,
  Bot,
  Coins,
  Image,
  Cpu,
  Sun,
  Gamepad2,
  Palette,
  Heart,
  Coffee,
  Beer,
  Briefcase,
  Smile,
  Music,
  GraduationCap,
  Play,
  Diamond,
  Globe,
  UtensilsCrossed,
  Drama,
  type LucideIcon,
} from 'lucide-react';
import { VIBE_COLORS } from '@/lib/constants';

export const TAG_ICONS: Record<string, LucideIcon> = {
  'Conference': Landmark,
  'Panel/Talk': Mic,
  'Hackathon': Code,
  'Networking': Users,
  'Devs/Builders': Wrench,
  'VCs/Angels': TrendingUp,
  'AI': Bot,
  'DeFi': Coins,
  'DAOs': Users,
  'NFTs': Image,
  'DePIN': Cpu,
  'RWA': Globe,
  'ETH': Diamond,
  'BTC': Coins,
  'SOL': Sun,
  'Gaming': Gamepad2,
  'Art': Palette,
  'Wellness': Heart,
  'Brunch': Coffee,
  'Bar/Pub': Beer,
  'Jobs/Hiring': Briefcase,
  'Memecoins': Smile,
  'Party': Music,
  'Workshop': GraduationCap,
  'Meetup': Users,
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
