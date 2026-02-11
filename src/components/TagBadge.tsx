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
};

interface TagBadgeProps {
  tag: string;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
}

export function TagBadge({ tag, size = 'sm', iconOnly = false }: TagBadgeProps) {
  const Icon = TAG_ICONS[tag];
  const color = VIBE_COLORS[tag] || VIBE_COLORS['default'];
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-xs font-medium text-white ${iconOnly ? 'w-6 h-6' : 'gap-1 px-2 py-0.5'}`}
      style={{ backgroundColor: color }}
      title={tag}
    >
      {Icon && <Icon className={`${iconSize} flex-shrink-0`} />}
      {!iconOnly && tag}
    </span>
  );
}
