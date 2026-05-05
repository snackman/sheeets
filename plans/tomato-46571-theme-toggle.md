# tomato-46571: Light/Dark Theme Toggle

**Task ID**: tomato-46571
**Priority**: P2
**Feature**: Full light/dark theme toggle with Google-Sheets-inspired light palette

---

## Overview

The Sheeets app is currently dark-mode-only with hardcoded dark Tailwind classes everywhere. This plan adds:
1. A CSS-variable-driven dual-theme system (light default, dark via `.dark` class on `<html>`)
2. A `ThemeProvider` context with system-preference detection and localStorage persistence
3. A sun/moon toggle button in the Header
4. Component-by-component class updates for every file in the app
5. Mapbox style switching (light vs dark map tiles)
6. Proper contrast adjustments for tag colors on light backgrounds

---

## 1. Tailwind v4 Dark Mode Configuration

Sheeets uses **Tailwind CSS v4** (no `tailwind.config.js` -- config is in `globals.css` via `@theme`).

In Tailwind v4, `dark:` variant works by default with the CSS `prefers-color-scheme: dark` media query. To switch to **class-based** dark mode (so we control it via JS), add this to `globals.css`:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

This tells Tailwind v4 that `dark:` variants should activate when the `.dark` class is on an ancestor element (i.e., `<html class="dark">`).

**File**: `src/app/globals.css`
**Action**: Add the `@custom-variant` directive after the `@import` lines.

---

## 2. CSS Variables -- Complete Updated Block

**File**: `src/app/globals.css`

Replace the current `:root` variables and add `.dark` overrides. The light theme uses the Google Sheets palette; the dark theme preserves the current look.

```css
@import 'mapbox-gl/dist/mapbox-gl.css';
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* Safe area insets for notched devices */
:root {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --safe-area-left: env(safe-area-inset-left, 0px);
  --safe-area-right: env(safe-area-inset-right, 0px);
}

/* ====== LIGHT THEME (default) ====== */
:root {
  --background: #FFFFFF;
  --foreground: #1D1D1D;
  --card: #F0F4F8;
  --card-hover: #E2E8F0;
  --border: #C8D0D8;
  --border-light: #E2E8F0;
  --header-bg: #1F3864;
  --header-text: #FFFFFF;
  --surface: #FFFFFF;
  --surface-secondary: #F7F9FB;
  --text-primary: #1D1D1D;
  --text-secondary: #4A5568;
  --text-muted: #718096;
  --text-faint: #A0AEC0;
  --accent: #f97316;
  --accent-hover: #fb923c;
  --input-bg: #FFFFFF;
  --input-border: #C8D0D8;
  --input-focus-border: #f97316;
  --overlay-bg: rgba(0, 0, 0, 0.3);
  --popup-bg: #FFFFFF;
  --popup-border: #C8D0D8;
  --popup-shadow: rgba(0, 0, 0, 0.15);
  --scrollbar-track: #F0F4F8;
  --scrollbar-thumb: #C8D0D8;
  --scrollbar-thumb-hover: #A0AEC0;
  --table-row-alt: #F0F6FF;
  --table-header-bg: #1F3864;
  --table-header-text: #FFFFFF;
  --slider-track: #C8D0D8;
  --map-label-bg: rgba(255, 255, 255, 0.9);
  --map-label-text: #1D1D1D;
  --badge-inactive-bg: #E2E8F0;
  --badge-inactive-text: #4A5568;
}

/* ====== DARK THEME ====== */
.dark {
  --background: #0f172a;
  --foreground: #f1f5f9;
  --card: #1e293b;
  --card-hover: #334155;
  --border: #334155;
  --border-light: #1e293b;
  --header-bg: rgba(15, 23, 42, 0.95);
  --header-text: #FFFFFF;
  --surface: #0f172a;
  --surface-secondary: #1e293b;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --text-faint: #475569;
  --accent: #f97316;
  --accent-hover: #fb923c;
  --input-bg: #1e293b;
  --input-border: #475569;
  --input-focus-border: #f97316;
  --overlay-bg: rgba(0, 0, 0, 0.5);
  --popup-bg: #1e293b;
  --popup-border: #334155;
  --popup-shadow: rgba(0, 0, 0, 0.5);
  --scrollbar-track: #0f172a;
  --scrollbar-thumb: #334155;
  --scrollbar-thumb-hover: #475569;
  --table-row-alt: transparent;
  --table-header-bg: #1e293b;
  --table-header-text: #94a3b8;
  --slider-track: #334155;
  --map-label-bg: rgba(30, 41, 59, 0.9);
  --map-label-text: #FFFFFF;
  --badge-inactive-bg: #334155;
  --badge-inactive-text: #cbd5e1;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-inter);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-inter), system-ui, -apple-system, sans-serif;
  padding-top: var(--safe-area-top);
  padding-bottom: var(--safe-area-bottom);
}

/* Prevent iOS auto-zoom on input focus */
input, select, textarea {
  font-size: 16px;
}

/* Custom scrollbar -- theme-aware */
::-webkit-scrollbar {
  width: 8px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}
::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

/* Card hover custom shade */
.hover\:bg-slate-750:hover {
  background-color: #283548;
}

/* Mapbox popup bounds */
.mapboxgl-popup {
  max-width: calc(100vw - 1rem) !important;
}

/* Mapbox popup overrides -- theme-aware */
.map-popup .mapboxgl-popup-content {
  background-color: var(--popup-bg);
  border: 1px solid var(--popup-border);
  border-radius: 8px;
  padding: 12px;
  box-shadow: 0 4px 24px var(--popup-shadow);
  max-width: calc(100vw - 2rem);
}
.map-popup .mapboxgl-popup-tip {
  border-top-color: var(--popup-bg);
}
.map-popup .mapboxgl-popup-close-btn {
  display: none;
}

/* Scrollbar styling for multi-event popup */
.map-popup .mapboxgl-popup-content ::-webkit-scrollbar {
  width: 4px;
}
.map-popup .mapboxgl-popup-content ::-webkit-scrollbar-track {
  background: transparent;
}
.map-popup .mapboxgl-popup-content ::-webkit-scrollbar-thumb {
  background-color: var(--scrollbar-thumb);
  border-radius: 2px;
}

/* Hide scrollbar for filter rows */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
```

---

## 3. Theme Provider

**New file**: `src/contexts/ThemeContext.tsx`

```tsx
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'sheeets-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark'); // SSR-safe default
  const [mounted, setMounted] = useState(false);

  // On mount: read localStorage or system preference
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') {
      setThemeState(stored);
    } else {
      // Detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setThemeState(prefersDark ? 'dark' : 'light');
    }
    setMounted(true);
  }, []);

  // Apply class to <html> whenever theme changes
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, mounted]);

  // Listen for system preference changes (only when no explicit user choice)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

### Flash prevention script

To prevent the flash of wrong theme on page load (FOUC), add an inline script to `<head>` that reads localStorage and applies the `.dark` class **before** React hydrates.

**File**: `src/app/layout.tsx`

Update the `<html>` tag and add a `<script>` in `<head>`:

```tsx
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: "sheeets.xyz",
  description:
    "Browse and discover crypto conference side events. Filter by date, time, tags, and more.",
};

// Inline script to apply dark class before paint (prevents FOUC)
const themeScript = `
  (function() {
    try {
      var t = localStorage.getItem('sheeets-theme');
      if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    } catch(e) {}
  })();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Note: `suppressHydrationWarning` on `<html>` prevents React from complaining about the class mismatch between server and client.

### Update Providers

**File**: `src/components/Providers.tsx`

```tsx
'use client';

import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>{children}</AuthProvider>
    </ThemeProvider>
  );
}
```

---

## 4. Add STORAGE_KEYS entry

**File**: `src/lib/constants.ts`

Add `THEME` key to `STORAGE_KEYS`:

```ts
export const STORAGE_KEYS = {
  ITINERARY: 'sheeets-itinerary',
  ITINERARY_UPDATED: 'sheeets-itinerary-updated',
  VIEW_MODE: 'sheeets-view',
  THEME: 'sheeets-theme',
};
```

---

## 5. Component-by-Component Changes

Below, every hardcoded dark Tailwind class is listed with its replacement. The pattern is:

- **Light-first**: `bg-white dark:bg-slate-900` (light value first, dark override with `dark:` prefix)
- CSS variable references where appropriate for things controlled by the theme vars

### Key Mapping Legend

| Current (dark-only) | Light equivalent | Combined |
|---|---|---|
| `bg-slate-900` | `bg-white` | `bg-white dark:bg-slate-900` |
| `bg-slate-900/95` | `bg-white/95` | `bg-white/95 dark:bg-slate-900/95` |
| `bg-slate-800` | `bg-gray-100` | `bg-gray-100 dark:bg-slate-800` |
| `bg-slate-800/90` | `bg-white/90` | `bg-white/90 dark:bg-slate-800/90` |
| `bg-slate-800/80` | `bg-gray-50/80` | `bg-gray-50/80 dark:bg-slate-800/80` |
| `bg-slate-700` | `bg-gray-200` | `bg-gray-200 dark:bg-slate-700` |
| `bg-slate-700/50` | `bg-gray-100/50` | `bg-gray-100/50 dark:bg-slate-700/50` |
| `hover:bg-slate-750` | `hover:bg-gray-100` | `hover:bg-gray-100 dark:hover:bg-slate-750` |
| `hover:bg-slate-700` | `hover:bg-gray-200` | `hover:bg-gray-200 dark:hover:bg-slate-700` |
| `hover:bg-slate-600` | `hover:bg-gray-300` | `hover:bg-gray-300 dark:hover:bg-slate-600` |
| `hover:bg-slate-600/50` | `hover:bg-gray-200/50` | `hover:bg-gray-200/50 dark:hover:bg-slate-600/50` |
| `text-white` | `text-gray-900` | `text-gray-900 dark:text-white` |
| `text-slate-100` | `text-gray-900` | `text-gray-900 dark:text-slate-100` |
| `text-slate-200` | `text-gray-800` | `text-gray-800 dark:text-slate-200` |
| `text-slate-300` | `text-gray-700` | `text-gray-700 dark:text-slate-300` |
| `text-slate-400` | `text-gray-500` | `text-gray-500 dark:text-slate-400` |
| `text-slate-500` | `text-gray-400` | `text-gray-400 dark:text-slate-500` |
| `text-slate-600` | `text-gray-300` | `text-gray-300 dark:text-slate-600` |
| `border-slate-800` | `border-gray-200` | `border-gray-200 dark:border-slate-800` |
| `border-slate-700` | `border-gray-200` | `border-gray-200 dark:border-slate-700` |
| `border-slate-600` | `border-gray-300` | `border-gray-300 dark:border-slate-600` |
| `hover:text-slate-200` | `hover:text-gray-800` | `hover:text-gray-800 dark:hover:text-slate-200` |
| `hover:text-white` | `hover:text-gray-900` | `hover:text-gray-900 dark:hover:text-white` |
| `active:text-slate-200` | `active:text-gray-800` | `active:text-gray-800 dark:active:text-slate-200` |
| `active:bg-slate-700` | `active:bg-gray-200` | `active:bg-gray-200 dark:active:bg-slate-700` |
| `active:bg-slate-600` | `active:bg-gray-300` | `active:bg-gray-300 dark:active:bg-slate-600` |
| `divide-slate-700/50` | `divide-gray-200` | `divide-gray-200 dark:divide-slate-700/50` |

**IMPORTANT**: Elements that are **always** styled the same in both themes (e.g., the orange accent buttons when active, `bg-orange-500 text-white`) do NOT need `dark:` variants. Only change elements whose appearance differs between themes.

---

### 5.1 Header.tsx

**File**: `src/components/Header.tsx`

| Line | Current | New |
|---|---|---|
| 30 | `bg-slate-900/95 backdrop-blur-sm border-b border-slate-800` | `bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-slate-800` |
| 37 | `text-white` (title) | `text-gray-900 dark:text-white` |
| 51 | `border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700` | `border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 active:text-gray-800 dark:active:text-slate-200 active:bg-gray-200 dark:active:bg-slate-700` |
| 73 | (itinerary inactive): `border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700` | Same mapping as sign-in button above |

**Add theme toggle button**: Insert between the auth controls and ViewToggle (or after ViewToggle). Import `Sun`, `Moon` from `lucide-react` and `useTheme` from `@/contexts/ThemeContext`.

```tsx
import { useTheme } from '@/contexts/ThemeContext';
import { Sun, Moon } from 'lucide-react';

// Inside the component:
const { theme, toggleTheme } = useTheme();

// In JSX, between auth and ViewToggle:
<button
  onClick={toggleTheme}
  className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
>
  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
</button>
```

---

### 5.2 FilterBar.tsx

**File**: `src/components/FilterBar.tsx`

| Location | Current | New |
|---|---|---|
| Outer container (line 63) | `bg-slate-900 border-b border-slate-800` | `bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800` |
| Mobile conf dropdown bg (line 84) | `bg-slate-800 border border-slate-700` | `bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700` |
| Conf dropdown inactive btn (line 98) | `text-slate-300 hover:bg-slate-700 active:bg-slate-700` | `text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 active:bg-gray-100 dark:active:bg-slate-700` |
| Desktop conf inactive (line 119) | `bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700` | `bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 active:text-gray-800 dark:active:text-slate-200 active:bg-gray-200 dark:active:bg-slate-700` |
| Desktop conf border (line 110) | `border border-slate-700` | `border border-gray-200 dark:border-slate-700` |
| Now toggle inactive (line 136) | `bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700 border border-slate-700` | `bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 active:text-gray-800 dark:active:text-slate-200 active:bg-gray-200 dark:active:bg-slate-700 border border-gray-200 dark:border-slate-700` |
| Filter toggle inactive (line 155) | `bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700 border border-slate-700` | Same mapping as Now toggle inactive |
| Expanded filter overlay (line 171) | `bg-slate-900` (mobile bg) | `bg-white dark:bg-slate-900` |
| Now mode notice (line 174) | `bg-green-500/10 border border-green-500/20 text-green-400` | Keep as-is (green on both themes works) |
| Section labels (lines 183, 248, 296, 329) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Slider value labels (lines 186/251) | `text-slate-300` | `text-gray-700 dark:text-slate-300` |
| Slider track bg (lines 195/256) | `bg-slate-700` | `bg-gray-200 dark:bg-slate-700` |
| Vibe/tag inactive buttons (lines 313/347) | `bg-slate-700 text-slate-300 hover:bg-slate-600 active:bg-slate-600` | `bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-600 active:bg-gray-300 dark:active:bg-slate-600` |

---

### 5.3 EventCard.tsx

**File**: `src/components/EventCard.tsx`

| Location | Current | New |
|---|---|---|
| Card container (line 25) | `bg-slate-800 border border-slate-700 ... hover:bg-slate-750 hover:border-slate-600 active:bg-slate-750 active:border-slate-600` | `bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 ... hover:bg-gray-50 dark:hover:bg-slate-750 hover:border-gray-300 dark:hover:border-slate-600 active:bg-gray-50 dark:active:bg-slate-750 active:border-gray-300 dark:active:border-slate-600` |
| Event name (line 40) | `text-white` | `text-gray-900 dark:text-white` |
| Organizer (line 58) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Date/time (line 62) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Address (line 68) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Note (line 85) | `text-slate-600` | `text-gray-400 dark:text-slate-600` |

---

### 5.4 ListView.tsx

**File**: `src/components/ListView.tsx`

| Location | Current | New |
|---|---|---|
| Empty state (line 73) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Date header (line 86) | `bg-slate-900/95 backdrop-blur-sm ... border-b border-slate-800` | `bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm ... border-b border-gray-200 dark:border-slate-800` |
| Date label (line 88) | `text-white` | `text-gray-900 dark:text-white` |
| Event count (line 91) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |

---

### 5.5 TableView.tsx

**File**: `src/components/TableView.tsx`

| Location | Current | New |
|---|---|---|
| Table border (line 22) | `border border-slate-700` | `border border-gray-200 dark:border-slate-700` |
| Table header (line 24) | `text-slate-400 bg-slate-800 border-b border-slate-700` | `text-gray-500 dark:text-slate-400 bg-[#1F3864] dark:bg-slate-800 text-white dark:text-slate-400 border-b border-gray-200 dark:border-slate-700` |

Note: In light mode the table header uses the Google Sheets header blue `#1F3864` with white text. In dark mode it stays `bg-slate-800` with `text-slate-400`. This needs careful handling:

```tsx
<thead className="text-xs uppercase tracking-wider sticky top-0 z-10 bg-[#1F3864] text-white dark:bg-slate-800 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
```

| Location | Current | New |
|---|---|---|
| `<tbody>` divider (line 35) | `divide-y divide-slate-700/50` | `divide-y divide-gray-100 dark:divide-slate-700/50` |
| Row bg (line 42) | `bg-slate-900` (normal) | `bg-white dark:bg-slate-900` |
| Row hover (line 42) | `hover:bg-slate-800/70` | `hover:bg-gray-50 dark:hover:bg-slate-800/70` |
| Duplicate row bg | `bg-red-950/30` | `bg-red-50 dark:bg-red-950/30` |
| Star inactive (line 53) | `text-slate-600 hover:text-slate-400` | `text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400` |
| Date cell (line 59) | `text-slate-300` | `text-gray-700 dark:text-slate-300` |
| Time cell (line 64) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Organizer cell (line 70) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Event name cell (line 75) | `text-slate-100` | `text-gray-900 dark:text-slate-100` |
| Location cell (line 96) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Extra tags count (line 116) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Empty state (line 128) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |

**Alternate row striping for light mode**: Add alternating row backgrounds using even/odd:

```tsx
<tr
  key={event.id}
  className={`transition-colors ${
    event.isDuplicate
      ? 'bg-red-50 dark:bg-red-950/30'
      : 'bg-white dark:bg-slate-900 even:bg-[#D6E4F0]/30 dark:even:bg-transparent'
  } hover:bg-gray-50 dark:hover:bg-slate-800/70`}
>
```

---

### 5.6 MapView.tsx

**File**: `src/components/MapView.tsx`

| Location | Current | New |
|---|---|---|
| Map style (line 180) | `"mapbox://styles/mapbox/dark-v11"` | **Dynamic** -- see below |
| No-token fallback bg (line 161) | `bg-slate-900` | `bg-gray-100 dark:bg-slate-900` |
| No-token text (line 163) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| No-token subtext (line 166) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Locate button inactive (line 197) | `bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700` | `bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700` |

**Dynamic Mapbox style**:

Import and use the theme context:

```tsx
import { useTheme } from '@/contexts/ThemeContext';

// Inside component:
const { theme } = useTheme();
const mapStyle = theme === 'dark'
  ? 'mapbox://styles/mapbox/dark-v11'
  : 'mapbox://styles/mapbox/streets-v12';
```

Then use `mapStyle={mapStyle}` on the `<MapGL>` component.

**Note**: When the theme changes, the map style will re-render. This is fine -- Mapbox handles style transitions smoothly.

---

### 5.7 MapMarker.tsx

**File**: `src/components/MapMarker.tsx`

| Location | Current | New |
|---|---|---|
| Label card (line 88) | `bg-slate-800/90 text-white` | `bg-white/90 dark:bg-slate-800/90 text-gray-900 dark:text-white` |
| Label time (line 91) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |

---

### 5.8 EventPopup.tsx

**File**: `src/components/EventPopup.tsx`

The popup background is handled by CSS (`.map-popup` styles in globals.css, already using CSS variables). The inline text classes need updating:

| Location | Current | New |
|---|---|---|
| Event name (line 52) | `text-white` | `text-gray-900 dark:text-white` |
| Hover on name (line 52) | `hover:text-orange-300` | `hover:text-orange-500 dark:hover:text-orange-300` |
| Organizer (line 62) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Close btn (line 76) | `text-slate-400 hover:text-white active:text-white` | `text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white active:text-gray-900 dark:active:text-white` |
| Cost text (line 92) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Date/time (line 98) | `text-slate-300` | `text-gray-700 dark:text-slate-300` |
| Multi-popup title (line 154) | `text-white` | `text-gray-900 dark:text-white` |
| Multi close btn (line 158) | `text-slate-400 hover:text-white active:text-white` | Same as single close btn |
| Multi event button (line 172) | `bg-slate-700/50 hover:bg-slate-600/50 active:bg-slate-600/50` | `bg-gray-100/50 dark:bg-slate-700/50 hover:bg-gray-200/50 dark:hover:bg-slate-600/50 active:bg-gray-200/50 dark:active:bg-slate-600/50` |
| Multi event name (line 175) | `text-white` | `text-gray-900 dark:text-white` |
| Multi event time (line 185) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |

---

### 5.9 ItineraryPanel.tsx

**File**: `src/components/ItineraryPanel.tsx`

| Location | Current | New |
|---|---|---|
| Panel bg (line 230) | `bg-slate-900 border-l border-slate-700` | `bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700` |
| Panel header border (line 235) | `border-b border-slate-800` | `border-b border-gray-200 dark:border-slate-800` |
| Title (line 236) | `text-white` | `text-gray-900 dark:text-white` |
| Count text (line 238) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Icon buttons (lines 248-269) | `text-slate-400 hover:text-orange-400 active:text-orange-400` | `text-gray-400 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 active:text-orange-500 dark:active:text-orange-400` |
| Close btn (line 274) | `text-slate-400 hover:text-white active:text-white` | `text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white active:text-gray-900 dark:active:text-white` |
| Conf tabs border (line 285) | `border-b border-slate-800` | `border-b border-gray-200 dark:border-slate-800` |
| Conf tab inactive (line 292-293) | `border-transparent text-slate-400 hover:text-slate-200 active:text-slate-200` | `border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 active:text-gray-800 dark:active:text-slate-200` |
| Empty state icon (line 307) | `text-slate-600` | `text-gray-300 dark:text-slate-600` |
| Empty state text (line 309) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Empty subtext (line 311) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Capture bg (line 318) | `bg-slate-900` | `bg-white dark:bg-slate-900` |
| Branding text (line 322) | `text-white` | `text-gray-900 dark:text-white` |
| Branding subtext (line 323) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Divider line (line 342) | `bg-slate-700` | `bg-gray-200 dark:bg-slate-700` |
| Date header (line 343) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Event card (line 362) | `bg-slate-800 ... border-slate-700` | `bg-gray-50 dark:bg-slate-800 ... border-gray-200 dark:border-slate-700` |
| Event name (line 380) | `text-white` | `text-gray-900 dark:text-white` |
| Remove btn (line 386) | `text-slate-500 hover:text-red-400 active:text-red-400` | `text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 active:text-red-500 dark:active:text-red-400` |
| Time text (line 395) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Footer (line 424) | `text-slate-600` | `text-gray-400 dark:text-slate-600` |
| Clear section border (line 431) | `border-t border-slate-800` | `border-t border-gray-200 dark:border-slate-800` |
| Clear confirm text (line 434) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Cancel btn (line 444) | `bg-slate-700 hover:bg-slate-600 active:bg-slate-600 text-slate-300` | `bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 active:bg-gray-300 dark:active:bg-slate-600 text-gray-700 dark:text-slate-300` |
| Clear itinerary btn (line 453) | `bg-slate-800 hover:bg-slate-700 active:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-300 active:text-slate-300` | `bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 active:bg-gray-200 dark:active:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 active:text-gray-700 dark:active:text-slate-300` |

**PNG export note**: The `handleSharePNG` function uses `backgroundColor: '#0f172a'` hardcoded. This should be made theme-aware:

```tsx
const { theme } = useTheme();
// ...
const blob = await toBlob(captureRef.current, {
  backgroundColor: theme === 'dark' ? '#0f172a' : '#FFFFFF',
  pixelRatio: 2,
});
```

---

### 5.10 AuthModal.tsx

**File**: `src/components/AuthModal.tsx`

| Location | Current | New |
|---|---|---|
| Modal bg (line 111) | `bg-slate-800 border border-slate-700` | `bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700` |
| Header border (line 113) | `border-b border-slate-700` | `border-b border-gray-200 dark:border-slate-700` |
| Title (line 114) | `text-white` | `text-gray-900 dark:text-white` |
| Close btn (line 119) | `text-slate-400 hover:text-white` | `text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white` |
| Description (line 128) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Input container (line 131) | `bg-slate-900 border border-slate-600` | `bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600` |
| Input icon (line 132) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Input text (line 138) | `text-white ... placeholder:text-slate-500` | `text-gray-900 dark:text-white ... placeholder:text-gray-400 dark:placeholder:text-slate-500` |
| Code description (line 156-157) | `text-slate-400` / `text-white` | `text-gray-500 dark:text-slate-400` / `text-gray-900 dark:text-white` |
| Code inputs (line 170) | `bg-slate-900 border border-slate-600 text-white` | `bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white` |
| Different email btn (line 178) | `text-slate-400 hover:text-slate-300` | `text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300` |
| Success text (line 188) | `text-white` | `text-gray-900 dark:text-white` |
| Success subtext (line 189) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |

**UserMenu** (line 199+):

| Location | Current | New |
|---|---|---|
| Email text (line 206) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Sign out btn (line 211) | `text-slate-400 hover:text-white` | `text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white` |

---

### 5.11 SearchBar.tsx

**File**: `src/components/SearchBar.tsx`

| Location | Current | New |
|---|---|---|
| Search icon (line 52) | `text-slate-400` | `text-gray-400 dark:text-slate-400` |
| Input (line 58) | `bg-slate-800 border border-slate-600 text-white placeholder-slate-400` | `bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-400` |
| Clear btn (line 63) | `text-slate-400 hover:text-slate-200` | `text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200` |

---

### 5.12 ViewToggle.tsx

**File**: `src/components/ViewToggle.tsx`

| Location | Current | New |
|---|---|---|
| Container border (line 20) | `border border-slate-700` | `border border-gray-200 dark:border-slate-700` |
| Inactive button (line 29) | `bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700` | `bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700 active:text-gray-800 dark:active:text-slate-200 active:bg-gray-200 dark:active:bg-slate-700` |

---

### 5.13 TagBadge.tsx

**File**: `src/components/TagBadge.tsx`

No changes needed. TagBadge uses `style={{ backgroundColor: color }}` with white text, which works on both themes since the colored background provides its own contrast.

---

### 5.14 StarButton.tsx

**File**: `src/components/StarButton.tsx`

| Location | Current | New |
|---|---|---|
| Inactive star (line 32) | `text-slate-600 hover:text-yellow-400/60 active:text-yellow-400/60` | `text-gray-300 dark:text-slate-600 hover:text-yellow-500/60 dark:hover:text-yellow-400/60 active:text-yellow-500/60 dark:active:text-yellow-400/60` |

---

### 5.15 Loading.tsx

**File**: `src/components/Loading.tsx`

| Location | Current | New |
|---|---|---|
| Loading text (line 9) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |

---

### 5.16 EventApp.tsx

**File**: `src/components/EventApp.tsx`

| Location | Current | New |
|---|---|---|
| Loading wrapper (line 117) | `bg-slate-900` | `bg-white dark:bg-slate-900` |
| Error wrapper (line 132) | `bg-slate-900` | `bg-white dark:bg-slate-900` |
| Error text (line 141) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Main wrapper (line 155) | `bg-slate-900` (appears 3 times) | `bg-white dark:bg-slate-900` |

---

### 5.17 OGImage.tsx

**File**: `src/components/OGImage.tsx`

| Location | Current | New |
|---|---|---|
| Container bg (line 58) | `bg-slate-700/30` | `bg-gray-200/30 dark:bg-slate-700/30` |
| Image fallback bg (line 63) | `bg-slate-900/50` | `bg-gray-100/50 dark:bg-slate-900/50` |
| Loading pulse (line 69) | `bg-slate-700/50` | `bg-gray-200/50 dark:bg-slate-700/50` |

---

### 5.18 MapViewWrapper.tsx

**File**: `src/components/MapViewWrapper.tsx`

| Location | Current | New |
|---|---|---|
| Dynamic import loading (line 15) | `bg-slate-900` / `text-slate-400` | `bg-gray-100 dark:bg-slate-900` / `text-gray-500 dark:text-slate-400` |
| Drawer bg (line 61) | `bg-slate-900/95 ... border-t border-slate-700` | `bg-white/95 dark:bg-slate-900/95 ... border-t border-gray-200 dark:border-slate-700` |
| Event row (line 71) | `bg-slate-800/80` | `bg-gray-50/80 dark:bg-slate-800/80` |
| Date/time text (line 89) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Event name (line 91) | `text-white` | `text-gray-900 dark:text-white` |
| Organizer (line 96) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Toggle tab (line 121) | `bg-slate-800/90 ... border border-slate-600 ... text-slate-300 hover:text-white hover:bg-slate-700 active:bg-slate-700` | `bg-white/90 dark:bg-slate-800/90 ... border border-gray-300 dark:border-slate-600 ... text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-700 active:bg-gray-100 dark:active:bg-slate-700` |

---

### 5.19 Itinerary Page (`src/app/itinerary/page.tsx`)

**File**: `src/app/itinerary/page.tsx`

This file has extensive dark-only styling similar to ItineraryPanel. Apply the same mapping pattern:

| Location | Current | New |
|---|---|---|
| Dynamic import loading (line 24) | `bg-slate-900` / `text-slate-400` | `bg-gray-100 dark:bg-slate-900` / `text-gray-500 dark:text-slate-400` |
| Loading wrapper (line 199) | `bg-slate-900` | `bg-white dark:bg-slate-900` |
| Page wrapper (line 206) | `bg-slate-900` | `bg-white dark:bg-slate-900` |
| Header (line 208) | `bg-slate-900/95 ... border-b border-slate-800` | `bg-white/95 dark:bg-slate-900/95 ... border-b border-gray-200 dark:border-slate-800` |
| Back arrow (line 213) | `text-slate-400 hover:text-white` | `text-gray-400 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white` |
| Title (line 218) | `text-white` | `text-gray-900 dark:text-white` |
| Count (line 220) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Conference toggle border (line 227) | `border border-slate-700` | `border border-gray-200 dark:border-slate-700` |
| Conf inactive (line 236) | `bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700` | `bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-700` |
| View toggle border (line 248) | `border border-slate-700` | `border border-gray-200 dark:border-slate-700` |
| View toggle inactive (line 258) | `bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700` | Same as conf inactive |
| Export buttons (lines 271-286) | `text-slate-400 hover:text-orange-400` | `text-gray-400 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-400` |
| Share link button (line 293) | `bg-slate-800 border border-slate-700 text-slate-400 hover:text-orange-400 hover:border-slate-600` | `bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:text-orange-500 dark:hover:text-orange-400 hover:border-gray-300 dark:hover:border-slate-600` |
| Empty state (lines 308-320) | Same pattern as ItineraryPanel empty state |
| Capture bg (line 331) | `bg-slate-900` | `bg-white dark:bg-slate-900` |
| Branding (lines 332-335) | Same as ItineraryPanel |
| Date divider (line 350) | `bg-slate-700` | `bg-gray-200 dark:bg-slate-700` |
| Date label (line 351) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Event cards (line 368) | `bg-slate-800 ... border-slate-700` | `bg-gray-50 dark:bg-slate-800 ... border-gray-200 dark:border-slate-700` |
| Event name (line 382) | `text-white` | `text-gray-900 dark:text-white` |
| Remove button (line 399) | `text-slate-500 hover:text-red-400` | `text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400` |
| Organizer (line 408) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Time (line 411) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Address (line 414) | `text-slate-500` | `text-gray-400 dark:text-slate-500` |
| Footer (line 440) | `text-slate-600` | `text-gray-400 dark:text-slate-600` |
| Clear section border (line 445) | `border-t border-slate-800` | `border-t border-gray-200 dark:border-slate-800` |
| Clear confirm text (line 448) | `text-slate-400` | `text-gray-500 dark:text-slate-400` |
| Cancel btn (line 456) | `bg-slate-700 hover:bg-slate-600 text-slate-300` | `bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 text-gray-700 dark:text-slate-300` |
| Clear btn (line 465) | `bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-slate-300` | `bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300` |

**PNG export**: Same fix as ItineraryPanel -- make `backgroundColor` theme-aware. Import `useTheme`.

---

## 6. Tag/Vibe Color Contrast Analysis

The `VIBE_COLORS` from `constants.ts` are used as background colors with white text. On light backgrounds these badges float on the page. Analysis of colors that might lack contrast against white text:

| Tag | Color | White text contrast ratio | Issue? |
|---|---|---|---|
| Networking / BTC / $$ | `#F59E0B` (amber-500) | ~1.9:1 | **POOR** -- yellow on white text is hard to read |
| Bar/Pub | `#FBBF24` (amber-400) | ~1.5:1 | **POOR** |
| Brunch | `#FB923C` (orange-400) | ~2.2:1 | **Marginal** |

**Recommendation**: These tag badges always render with `style={{ backgroundColor: color }}` and `text-white`. The contrast issues exist in the current dark theme too (they float on dark backgrounds, so the badge itself provides contrast). Since the badge has its own opaque background, the white text on colored badge works the same regardless of page theme. **No changes needed to VIBE_COLORS.**

However, for the FilterBar's **inactive** tag buttons (which currently use `bg-slate-700 text-slate-300`), in light mode they will use `bg-gray-200 text-gray-700`, which provides good contrast. **No issues.**

---

## 7. Summary of New/Modified Files

### New files:
1. `src/contexts/ThemeContext.tsx` -- ThemeProvider + useTheme hook

### Modified files:
1. `src/app/globals.css` -- Complete rewrite of CSS variables, add `@custom-variant dark`
2. `src/app/layout.tsx` -- Add theme script, `suppressHydrationWarning`, `<head>` tag
3. `src/components/Providers.tsx` -- Wrap with ThemeProvider
4. `src/lib/constants.ts` -- Add THEME to STORAGE_KEYS
5. `src/components/Header.tsx` -- Theme-aware classes + theme toggle button
6. `src/components/FilterBar.tsx` -- Theme-aware classes
7. `src/components/EventCard.tsx` -- Theme-aware classes
8. `src/components/ListView.tsx` -- Theme-aware classes
9. `src/components/TableView.tsx` -- Theme-aware classes + alternate row striping
10. `src/components/MapView.tsx` -- Dynamic map style + theme-aware classes
11. `src/components/MapMarker.tsx` -- Theme-aware label classes
12. `src/components/EventPopup.tsx` -- Theme-aware text classes
13. `src/components/ItineraryPanel.tsx` -- Theme-aware classes + theme-aware PNG export
14. `src/components/AuthModal.tsx` -- Theme-aware classes
15. `src/components/SearchBar.tsx` -- Theme-aware classes
16. `src/components/ViewToggle.tsx` -- Theme-aware classes
17. `src/components/StarButton.tsx` -- Theme-aware inactive color
18. `src/components/Loading.tsx` -- Theme-aware text color
19. `src/components/EventApp.tsx` -- Theme-aware background classes
20. `src/components/OGImage.tsx` -- Theme-aware placeholder colors
21. `src/components/MapViewWrapper.tsx` -- Theme-aware classes
22. `src/app/itinerary/page.tsx` -- Theme-aware classes + theme-aware PNG export

---

## 8. Implementation Order

1. **`globals.css`** -- CSS variables + `@custom-variant dark` (foundation)
2. **`ThemeContext.tsx`** -- Create theme provider (new file)
3. **`layout.tsx`** -- Flash-prevention script + `suppressHydrationWarning`
4. **`Providers.tsx`** -- Wire in ThemeProvider
5. **`constants.ts`** -- Add THEME storage key
6. **`Header.tsx`** -- Add toggle button + theme-aware classes (verify toggle works)
7. **All remaining components** -- Apply class changes (can be done in any order)
8. **`MapView.tsx`** -- Dynamic map style (last, since it's the most complex)

---

## 9. Verification Steps

1. **Toggle test**: Click the sun/moon button in the header. Verify it switches between light and dark instantly with no flash.
2. **Persistence test**: Set to light mode, refresh the page. It should stay light. Same for dark.
3. **System preference test**: Clear localStorage (`sheeets-theme`), set OS to dark mode, reload. Should be dark. Switch OS to light, reload. Should be light.
4. **Component audit**: Go through every view (table, list, map) and verify no hardcoded dark backgrounds remain visible in light mode.
5. **Map test**: In light mode, verify the map uses light/streets tiles. In dark mode, verify dark tiles.
6. **Popup test**: Click a map marker in light mode. Verify the popup has a white background with dark text.
7. **Auth modal test**: Open the sign-in modal in light mode. Verify all inputs and text are readable.
8. **Itinerary panel test**: Open the itinerary sidebar in light mode. Verify cards, buttons, and empty state are properly themed.
9. **PNG export test**: In both modes, export itinerary as PNG. Light mode should have white background, dark mode should have dark background.
10. **Table alternating rows**: In light mode, verify even rows have the subtle blue tint (`#D6E4F0`).
11. **Table header**: In light mode, verify the table header is `#1F3864` dark blue with white text.
12. **Mobile test**: Test on mobile viewport -- verify the filter dropdown, conference selector, and all overlays are properly themed.
13. **Tag badges**: Verify colored badges are visible and readable in both themes.
14. **Build test**: Run `npm run build` to verify no TypeScript errors.

---

## 10. Edge Cases & Notes

- **html-to-image**: The PNG export hardcodes `backgroundColor`. Both ItineraryPanel and itinerary page need theme-aware values.
- **Mapbox navigation controls**: The default Mapbox `NavigationControl` has its own styling. In dark mode it may look odd on a light map (or vice versa). If this is a problem, pass custom CSS classes, but typically Mapbox controls auto-adapt to the map style.
- **`hover:bg-slate-750` custom class**: This only applies in dark mode. In light mode, `hover:bg-gray-50` or `hover:bg-gray-100` replaces it. The custom CSS rule in globals.css can stay as-is since it only triggers on `.hover\:bg-slate-750:hover` which will only be used with the `dark:` prefix now.
- **Transitions**: Consider adding `transition-colors` to `<body>` or `<html>` for a smooth theme switch animation. However, this could cause performance issues with the map. Recommend NOT adding a global transition -- the instant switch is fine.
- **Focus rings**: `focus:border-orange-500` works in both themes. No changes needed.
- **Orange accent**: Kept consistent across both themes as specified (`#f97316`).
