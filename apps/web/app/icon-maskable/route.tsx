import { ImageResponse } from 'next/og';

/**
 * The maskable variant.
 *
 * A launcher crops a maskable icon to whatever shape it likes, most often a
 * circle, so the mark has to sit inside the safe zone: the middle 80 percent.
 * Without this file Android takes the plain icon, shrinks it, and centres it on
 * a white disc, which is why so many installed sites look like a sticker.
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
        fontSize: 150,
        fontWeight: 800,
        letterSpacing: '-0.04em',
      }}
    >
      <div style={{ display: 'flex' }}>FPL</div>
      <div style={{ display: 'flex', width: 165, height: 18, background: '#e8214f' }} />
    </div>,
    size,
  );
}
