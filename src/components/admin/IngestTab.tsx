'use client';

import { useState } from 'react';
import type { TabConfig } from '@/lib/conferences';
import IngestQueue from './ingest/IngestQueue';
import IngestConfig from './ingest/IngestConfig';
import IngestLog from './ingest/IngestLog';
import IngestPrecision from './ingest/IngestPrecision';

interface Props {
  allConferenceTabs: TabConfig[];
  password: string;
}

type SubTab = 'queue' | 'config' | 'log' | 'precision';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'config', label: 'Config' },
  { key: 'log', label: 'Log' },
  { key: 'precision', label: 'Precision' },
];

/** Event-ingestion admin tab (plans/event-ingestion.md, Phase 1b), modeled on ClaimsTab. */
export default function IngestTab({ allConferenceTabs, password }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('queue');

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex gap-1 bg-stone-900 rounded-lg p-1 w-fit">
        {SUB_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
              subTab === key ? 'bg-stone-800 text-white' : 'text-stone-400 hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'queue' && <IngestQueue allConferenceTabs={allConferenceTabs} password={password} />}
      {subTab === 'config' && <IngestConfig allConferenceTabs={allConferenceTabs} password={password} />}
      {subTab === 'log' && <IngestLog allConferenceTabs={allConferenceTabs} password={password} />}
      {subTab === 'precision' && <IngestPrecision allConferenceTabs={allConferenceTabs} password={password} />}
    </div>
  );
}
