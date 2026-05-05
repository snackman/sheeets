'use client';

import { forwardRef, useMemo } from 'react';
import type { ETHDenverEvent } from '@/lib/types';
import { formatDateLabel } from '@/lib/utils';
import { sortByStartTime } from '@/lib/time-parse';

export type ShareCardMode = 'gallery' | 'text';

interface ShareCardTemplateProps {
  events: ETHDenverEvent[];
  conferenceName: string;
  displayName: string | null;
  avatarUrl?: string | null;
  flyerImages?: Map<string, string>;
  mode?: ShareCardMode;
}

const MAX_EVENTS = 15;

const ShareCardTemplate = forwardRef<HTMLDivElement, ShareCardTemplateProps>(
  function ShareCardTemplate({ events, conferenceName, displayName, avatarUrl, flyerImages, mode = 'gallery' }, ref) {
    const dateGroups = useMemo(() => {
      const groupMap = new Map<string, ETHDenverEvent[]>();
      for (const event of events) {
        const key = event.dateISO || 'unknown';
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(event);
      }
      return Array.from(groupMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([dateISO, groupEvents]) => ({
          dateISO,
          label: dateISO === 'unknown' ? 'Date TBD' : formatDateLabel(dateISO),
          events: groupEvents.sort(sortByStartTime),
        }));
    }, [events]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '8px' }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : displayName ? (
            <div
              style={{
                width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#292524',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '24px', fontWeight: 700, color: '#fbbf24', flexShrink: 0,
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          ) : null}
          <div
            style={{
              fontSize: '44px', fontWeight: 800, color: '#fafaf9',
              lineHeight: 1.2, letterSpacing: '-0.02em', flex: 1, minWidth: 0,
            }}
          >
            {conferenceName}
          </div>
        </div>

        {/* Amber separator */}
        <div style={{ height: '3px', backgroundColor: '#f59e0b', borderRadius: '2px', margin: '24px 0' }} />

        {/* Events block */}
        <div>
          {truncatedGroups.map((group) => (
            <div key={group.dateISO} style={{ marginBottom: '28px' }}>
              {/* Day header */}
              <div
                style={{
                  fontSize: '20px', fontWeight: 700, color: '#fbbf24',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid #292524',
                }}
              >
                {group.label}
              </div>

              {mode === 'gallery' ? (
                /* Gallery grid */
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {group.events.map((event) => {
                    const flyerDataUrl = flyerImages?.get(event.id);
                    const timeDisplay = event.isAllDay
                      ? 'All Day'
                      : `${event.startTime || ''}${event.endTime ? ` - ${event.endTime}` : ''}`;

                    return (
                      <div key={event.id} style={{ width: '486px' }}>
                        <div style={{ marginBottom: '6px', padding: '0 2px' }}>
                          <div
                            style={{
                              fontSize: '22px', fontWeight: 700, color: '#fafaf9',
                              lineHeight: 1.3, overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >
                            {event.name}
                          </div>
                          {timeDisplay && (
                            <div style={{ fontSize: '19px', fontWeight: 500, color: '#d6d3d1', marginTop: '2px' }}>
                              {timeDisplay}
                            </div>
                          )}
                        </div>
                        {flyerDataUrl ? (
                          <img
                            src={flyerDataUrl}
                            alt=""
                            style={{
                              width: '486px', height: '486px', objectFit: 'cover',
                              borderRadius: '8px', display: 'block',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '486px', height: '486px', backgroundColor: '#1c1917',
                              borderRadius: '8px',
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Text-only list */
                <div>
                  {group.events.map((event) => {
                    const timeDisplay = event.isAllDay
                      ? 'All Day'
                      : `${event.startTime || ''}${event.endTime ? ` - ${event.endTime}` : ''}`;

                    return (
                      <div
                        key={event.id}
                        style={{
                          display: 'flex', alignItems: 'baseline',
                          padding: '10px 0', gap: '16px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '18px', color: '#a8a29e',
                            minWidth: '140px', flexShrink: 0, whiteSpace: 'nowrap',
                          }}
                        >
                          {timeDisplay}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '22px', fontWeight: 600, color: '#fafaf9',
                              lineHeight: 1.3,
                            }}
                          >
                            {event.name}
                          </div>
                          {event.address && (
                            <div
                              style={{
                                fontSize: '16px', color: '#78716c', marginTop: '3px',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
              )}
            </div>
          ))}

          {truncated && remainingCount > 0 && (
            <div
              style={{
                fontSize: '18px', color: '#a8a29e', fontStyle: 'italic',
                textAlign: 'center', padding: '16px 0',
              }}
            >
              ... and {remainingCount} more event{remainingCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: '32px', paddingTop: '20px', borderTop: '1px solid #292524', textAlign: 'center' }}>
          <img
            src="/logo.png"
            alt="plan.wtf"
            style={{ height: '28px', filter: 'invert(1)', opacity: 0.5 }}
          />
        </div>
      </div>
    );
  }
);

export default ShareCardTemplate;
