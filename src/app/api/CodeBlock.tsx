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
    <div className="rounded-lg border border-violet-800 overflow-hidden">
      <div className="flex items-center justify-between bg-violet-900 border-b border-violet-800">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === i
                  ? 'bg-violet-800 text-white'
                  : 'text-violet-300 hover:text-violet-100 hover:bg-slate-750'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 mr-2 text-xs text-violet-300 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="bg-violet-950 p-4 overflow-x-auto">
        <pre className="text-sm leading-relaxed">
          <code className="text-violet-200 whitespace-pre">{tabs[activeTab].code}</code>
        </pre>
      </div>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 bg-violet-900 border border-violet-800 rounded text-sm text-cyan-300 font-mono">
      {children}
    </code>
  );
}
