'use client';

import { createContext, useContext } from 'react';

/**
 * What is currently narrowing the event list, so the shared empty state can say
 * so without every view having to thread the filter state through.
 */
export const ActiveFiltersContext = createContext<string[]>([]);

export function useActiveFilterSummary(): string[] {
  return useContext(ActiveFiltersContext);
}
