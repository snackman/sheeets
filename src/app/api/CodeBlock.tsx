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
    <div className="rounded-lg border border-sky-800 overflow-hidden">
      <div className="flex items-center justify-between bg-sky-900 border-b border-sky-800">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === i
                  ? 'bg-sky-800 text-white'
                  : 'text-sky-400 hover:text-sky-200 hover:bg-sky-850'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 mr-2 text-xs text-sky-400 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="bg-sky-950 p-4 overflow-x-auto">
        <pre className="text-sm leading-relaxed">
          <code className="text-sky-300 whitespace-pre">{tabs[activeTab].code}</code>
        </pre>
      </div>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 bg-sky-900 border border-sky-800 rounded text-sm text-teal-300 font-mono">
      {children}
    </code>
  );
}
