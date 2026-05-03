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

const PLATFORM_LOGOS: Record<string, string> = {
  x: `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#fafaf9"/><path d="M17.176 4h2.645l-5.78 6.606 6.8 8.994h-4.676l-4.17-5.453-4.77 5.453H4.58l6.18-7.066L4.2 4h4.795l3.77 4.984zm-.928 14.016h1.466L8.005 5.506H6.44z" fill="#0c0a09"/></svg>')}`,
  telegram: `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#fafaf9"/><path d="M11.944 3A9 9 0 0 0 3 12a9 9 0 0 0 9 9 9 9 0 0 0 9-9 9 9 0 0 0-9-9zm3.722 5.418c.075-.001.241.017.349.105a.38.38 0 0 1 .128.244c.012.07.027.23.015.354-.135 1.424-.721 4.877-1.02 6.47-.126.675-.374.901-.615.923-.522.049-.919-.345-1.425-.677-.792-.52-1.24-.843-2.009-1.35-.889-.585-.313-.908.194-1.433.133-.138 2.435-2.233 2.48-2.423.006-.024.011-.113-.042-.159s-.13-.031-.187-.018c-.08.018-1.345.856-3.796 2.51-.36.247-.685.367-.977.36-.321-.006-.939-.181-1.399-.33-.564-.184-1.012-.281-.973-.592.02-.162.244-.328.67-.498 2.624-1.143 4.372-1.897 5.249-2.261 2.499-1.04 3.019-1.221 3.357-1.226z" fill="#0c0a09"/></svg>')}`,
  linkedin: `data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#fafaf9"/><path d="M19.336 19.339h-3.065v-4.805c0-1.146-.023-2.62-1.596-2.62-1.597 0-1.842 1.247-1.842 2.536v4.889h-3.065V9.75h2.943v1.347h.042c.41-.776 1.412-1.596 2.907-1.596 3.107 0 3.68 2.044 3.68 4.703v5.135zM6.749 8.397c-.985 0-1.78-.8-1.78-1.782S5.764 4.833 6.749 4.833c.983 0 1.78.8 1.78 1.782s-.797 1.782-1.78 1.782zm1.537 10.942H5.212V9.75h3.074v9.589z" fill="#0c0a09"/></svg>')}`,
};

const LockScreenTemplate = forwardRef<HTMLDivElement, LockScreenTemplateProps>(
  function LockScreenTemplate({ displayName, company, jobTitle, avatarUrl, socialLinks }, ref) {
    const qrCount = socialLinks.length;
    const qrSize = qrCount === 1 ? 1050 : qrCount === 2 ? 520 : 340;

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
            gap: qrCount === 1 ? '0px' : '24px',
            paddingLeft: '24px',
            paddingRight: '24px',
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
              <QRCodeSVG
                value={link.url}
                size={qrSize}
                level="M"
                fgColor="#fafaf9"
                bgColor="#0c0a09"
                imageSettings={PLATFORM_LOGOS[link.platform] ? {
                  src: PLATFORM_LOGOS[link.platform],
                  height: Math.round(qrSize * 0.22),
                  width: Math.round(qrSize * 0.22),
                  excavate: true,
                } : undefined}
              />
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: 600,
                  color: '#a8a29e',
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
        <img
          src="/logo.png"
          alt="plan.wtf"
          crossOrigin="anonymous"
          style={{
            height: '60px',
            objectFit: 'contain',
            opacity: 0.4,
            filter: 'brightness(0) invert(1)',
          }}
        />

        {/* Bottom safe zone */}
        <div style={{ height: '200px', flexShrink: 0 }} />
      </div>
    );
  }
);

export default LockScreenTemplate;
