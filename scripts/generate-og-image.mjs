import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const WIDTH = 1200;
const HEIGHT = 630;
const BG_COLOR = '#1a1a1a';
const ACCENT_COLOR = '#e8960c'; // theme accent orange

// Create the OG image: dark background, logo centered, tagline below
async function generate() {
  // Load and resize logo (make it fit nicely, ~400px wide)
  const logo = await sharp(path.join(publicDir, 'logo.png'))
    .resize(480, null, { fit: 'inside' })
    .negate({ alpha: false }) // invert black→white for dark bg
    .toBuffer();

  const logoMeta = await sharp(logo).metadata();
  const logoW = logoMeta.width;
  const logoH = logoMeta.height;

  // Tagline as SVG text
  const tagline = 'Conference Side Events';
  const taglineSvg = Buffer.from(`
    <svg width="${WIDTH}" height="60">
      <text x="${WIDTH / 2}" y="40"
        font-family="Arial, Helvetica, sans-serif"
        font-size="32"
        font-weight="400"
        fill="#999999"
        text-anchor="middle"
        letter-spacing="1">
        ${tagline}
      </text>
    </svg>
  `);

  // Accent bar at bottom
  const barHeight = 6;
  const accentBar = Buffer.from(`
    <svg width="${WIDTH}" height="${barHeight}">
      <rect width="${WIDTH}" height="${barHeight}" fill="${ACCENT_COLOR}" />
    </svg>
  `);

  // Compose everything
  const logoTop = Math.round((HEIGHT - logoH - 80) / 2);
  const taglineTop = logoTop + logoH + 20;

  await sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: BG_COLOR,
    },
  })
    .composite([
      {
        input: logo,
        left: Math.round((WIDTH - logoW) / 2),
        top: logoTop,
      },
      {
        input: taglineSvg,
        left: 0,
        top: taglineTop,
      },
      {
        input: accentBar,
        left: 0,
        top: HEIGHT - barHeight,
        gravity: 'south',
      },
    ])
    .png()
    .toFile(path.join(publicDir, 'og-image.png'));

  console.log('Generated public/og-image.png (1200x630)');
}

generate().catch(console.error);
