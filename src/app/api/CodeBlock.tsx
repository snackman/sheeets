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
    <div className="rounded-lg border border-blue-700 overflow-hidden">
      <div className="flex items-center justify-between bg-blue-900 border-b border-blue-700">
        <div className="flex">
          {tabs.map((tab, i) => (
            <button
              key={tab.label}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-xs font-medium transition-colors cursor-pointer ${
                activeTab === i
                  ? 'bg-blue-800 text-white'
                  : 'text-blue-400 hover:text-blue-200 hover:bg-blue-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 mr-2 text-xs text-blue-400 hover:text-white transition-colors cursor-pointer"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="bg-blue-950 p-4 overflow-x-auto">
        <pre className="text-sm leading-relaxed">
          <code className="text-blue-300 whitespace-pre">{tabs[activeTab].code}</code>
        </pre>
      </div>
    </div>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 bg-blue-900 border border-blue-700 rounded text-sm text-orange-300 font-mono">
      {children}
    </code>
  );
}
