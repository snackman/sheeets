'use client';

import { forwardRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { SocialLink } from '@/lib/social-urls';

interface LockScreenTemplateProps {
  displayName: string | null;
  company: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  socialLinks: SocialLink[];
}

const PLATFORM_LABELS: Record<string, string> = {
  x: 'X / Twitter',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
};

const LockScreenTemplate = forwardRef<HTMLDivElement, LockScreenTemplateProps>(
  function LockScreenTemplate({ displayName, company, jobTitle, avatarUrl, socialLinks }, ref) {
    const qrCount = socialLinks.length;
    const qrSize = qrCount === 1 ? 360 : qrCount === 2 ? 280 : 220;

    return (
      <div
        ref={ref}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '1170px',
          height: '2532px',
          backgroundColor: '#0c0a09',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxSizing: 'border-box',
        }}
      >
        {/* Top safe zone for clock */}
        <div style={{ height: '300px', flexShrink: 0 }} />

        {/* Profile section */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px',
            paddingLeft: '60px',
            paddingRight: '60px',
          }}
        >
          {/* Avatar */}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              crossOrigin="anonymous"
              style={{
                width: '240px',
                height: '240px',
                borderRadius: '50%',
                objectFit: 'cover',
                border: '4px solid #292524',
              }}
            />
          ) : displayName ? (
            <div
              style={{
                width: '240px',
                height: '240px',
                borderRadius: '50%',
                backgroundColor: '#292524',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '96px',
                fontWeight: 700,
                color: '#fbbf24',
                border: '4px solid #292524',
              }}
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          ) : null}

          {/* Name */}
          {displayName && (
            <div
              style={{
                fontSize: '72px',
                fontWeight: 800,
                color: '#fafaf9',
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                textAlign: 'center',
              }}
            >
              {displayName}
            </div>
          )}

          {/* Company / Job Title */}
          {(company || jobTitle) && (
            <div
              style={{
                fontSize: '36px',
                fontWeight: 500,
                color: '#a8a29e',
                lineHeight: 1.3,
                textAlign: 'center',
              }}
            >
              {[company, jobTitle].filter(Boolean).join('  |  ')}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1, minHeight: '80px' }} />

        {/* QR codes */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            gap: qrCount === 1 ? '0px' : '48px',
            paddingLeft: '60px',
            paddingRight: '60px',
          }}
        >
          {socialLinks.map((link) => (
            <div
              key={link.platform}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  backgroundColor: '#0c0a09',
                  padding: '16px',
                  borderRadius: '16px',
                  border: '2px solid #292524',
                }}
              >
                <QRCodeSVG
                  value={link.url}
                  size={qrSize}
                  level="M"
                  fgColor="#fafaf9"
                  bgColor="#0c0a09"
                />
              </div>
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: 600,
                  color: '#a8a29e',
                  textAlign: 'center',
                }}
              >
                {PLATFORM_LABELS[link.platform] || link.platform}
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 400,
                  color: '#78716c',
                  textAlign: 'center',
                }}
              >
                {link.label}
              </div>
            </div>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1, minHeight: '60px' }} />

        {/* Branding */}
        <div
          style={{
            fontSize: '28px',
            fontWeight: 600,
            color: '#44403c',
            letterSpacing: '0.05em',
            textAlign: 'center',
          }}
        >
          plan.wtf
        </div>

        {/* Bottom safe zone */}
        <div style={{ height: '200px', flexShrink: 0 }} />
      </div>
    );
  }
);

export default LockScreenTemplate;
