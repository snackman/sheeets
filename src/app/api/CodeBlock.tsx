'use client';

import { useState } from 'react';

interface Tab {
  label: string;
  language: string;
  code: string;
}

export function CodeBlock({ tabs }: { tabs: Tab[] }) {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tabs[activeTab].code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <div className="rounded-lg border border-stone-700 overflow-hidden">
      <div className="flex items-center justify-between bg-stone-900 border-b border-stone-700">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === i
                  ? 'bg-stone-800 text-white'
                  : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 mr-2 text-xs text-stone-400 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="bg-stone-950 p-4 overflow-x-auto">
        <pre className="text-sm leading-relaxed">
          <code className="text-stone-300 whitespace-pre">{tabs[activeTab].code}</code>
        </pre>
      </div>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 bg-stone-900 border border-stone-700 rounded text-sm text-amber-300 font-mono">
      {children}
    </code>
  );
}
