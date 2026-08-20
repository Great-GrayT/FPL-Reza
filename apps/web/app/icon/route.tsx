import { ImageResponse } from 'next/og';

/**
 * The home screen icon, drawn rather than exported.
 *
 * It is the wordmark's own idea reduced to what survives at 48 pixels: the
 * paper, the ink, and the one flare mark the design rations. A photograph or a
 * crest would be somebody else's trademark; a monogram is this site's.
 */
export const dynamic = 'force-static';
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export function GET(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#edefe9',
        color: '#14181c',
        fontSize: 200,
        fontWeight: 800,
        letterSpacing: '-0.04em',
      }}
    >
      <div style={{ display: 'flex' }}>FPL</div>
      <div style={{ display: 'flex', width: 220, height: 24, background: '#e8214f' }} />
    </div>,
    size,
  );
}
