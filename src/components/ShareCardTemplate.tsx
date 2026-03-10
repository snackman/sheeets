'use client';

import { forwardRef, useMemo } from 'react';
import type { ETHDenverEvent } from '@/lib/types';
import { formatDateLabel } from '@/lib/utils';
import { sortByStartTime } from '@/lib/time-parse';

interface ShareCardTemplateProps {
  events: ETHDenverEvent[];
  conferenceName: string;
  dateRange: string;
  displayName: string | null;
}

const MAX_EVENTS = 15;

const ShareCardTemplate = forwardRef<HTMLDivElement, ShareCardTemplateProps>(
  function ShareCardTemplate({ events, conferenceName, dateRange, displayName }, ref) {
    const dateGroups = useMemo(() => {
      const groupMap = new Map<string, ETHDenverEvent[]>();
      for (const event of events) {
        const key = event.dateISO || 'unknown';
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(event);
      }
      return Array.from(groupMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateISO, groupEvents]) => ({
          dateISO,
          label: dateISO === 'unknown' ? 'Date TBD' : formatDateLabel(dateISO),
          events: groupEvents.sort(sortByStartTime),
        }));
    }, [events]);

    // Truncate to MAX_EVENTS using reduce to avoid mutable variables
    const { truncatedGroups, truncated, remainingCount } = useMemo(() => {
      const remaining = events.length > MAX_EVENTS ? events.length - MAX_EVENTS : 0;

      const result = dateGroups.reduce<{
        groups: typeof dateGroups;
        count: number;
        isTruncated: boolean;
      }>(
        (acc, group) => {
          if (acc.count >= MAX_EVENTS) {
            return { ...acc, isTruncated: true };
          }
          const available = MAX_EVENTS - acc.count;
          const slicedEvents = group.events.slice(0, available);
          return {
            groups: [...acc.groups, { ...group, events: slicedEvents }],
            count: acc.count + slicedEvents.length,
            isTruncated: acc.isTruncated || slicedEvents.length < group.events.length,
          };
        },
        { groups: [], count: 0, isTruncated: false }
      );

      return {
        truncatedGroups: result.groups,
        truncated: result.isTruncated,
        remainingCount: remaining,
      };
    }, [dateGroups, events.length]);

    return (
      <div
        ref={ref}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '1080px',
          backgroundColor: '#0c0a09',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '48px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '8px' }}>
          <div
            style={{
              fontSize: '42px',
              fontWeight: 800,
              color: '#fafaf9',
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
            }}
          >
            {conferenceName}
          </div>
          <div
            style={{
              fontSize: '20px',
              color: '#a8a29e',
              marginTop: '8px',
              lineHeight: 1.4,
            }}
          >
            {dateRange}
          </div>
          {displayName && (
            <div
              style={{
                fontSize: '22px',
                color: '#fbbf24',
                marginTop: '8px',
                fontWeight: 600,
              }}
            >
              {displayName}&apos;s Itinerary
            </div>
          )}
        </div>

        {/* Amber separator */}
        <div
          style={{
            height: '3px',
            backgroundColor: '#f59e0b',
            borderRadius: '2px',
            margin: '24px 0',
          }}
        />

        {/* Events block */}
        <div>
          {truncatedGroups.map((group) => (
            <div key={group.dateISO} style={{ marginBottom: '28px' }}>
              {/* Day header */}
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#fbbf24',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: '14px',
                  paddingBottom: '8px',
                  borderBottom: '1px solid #292524',
                }}
              >
                {group.label}
              </div>

              {/* Event rows */}
              {group.events.map((event) => {
                const timeDisplay = event.isAllDay
                  ? 'All Day'
                  : `${event.startTime}${event.endTime ? ` - ${event.endTime}` : ''}`;

                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      padding: '10px 0',
                      gap: '16px',
                    }}
                  >
                    {/* Time */}
                    <div
                      style={{
                        fontSize: '15px',
                        color: '#a8a29e',
                        minWidth: '130px',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {timeDisplay}
                    </div>

                    {/* Event details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '18px',
                          fontWeight: 600,
                          color: '#fafaf9',
                          lineHeight: 1.3,
                        }}
                      >
                        {event.name}
                      </div>
                      {event.address && (
                        <div
                          style={{
                            fontSize: '14px',
                            color: '#78716c',
                            marginTop: '3px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {event.address}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Truncation notice */}
          {truncated && remainingCount > 0 && (
            <div
              style={{
                fontSize: '16px',
                color: '#a8a29e',
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '16px 0',
              }}
            >
              ... and {remainingCount} more event{remainingCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: '32px',
            paddingTop: '20px',
            borderTop: '1px solid #292524',
            textAlign: 'center',
          }}
        >
          <span
            style={{
              fontSize: '16px',
              color: '#78716c',
              letterSpacing: '0.02em',
            }}
          >
            Built with sheeets.xyz
          </span>
        </div>
      </div>
    );
  }
);

export default ShareCardTemplate;
