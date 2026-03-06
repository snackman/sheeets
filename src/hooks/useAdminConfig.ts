'use client';

import { useState, useEffect } from 'react';
import { AdminConfig } from '@/lib/types';

export function useAdminConfig() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/config')
      .then(res => res.json())
      .then(data => {
        setConfig(data as AdminConfig);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { config, loading };
}
