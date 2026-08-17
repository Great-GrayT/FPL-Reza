import Image from 'next/image';
import { badgeUrl } from '@fpl/assets/urls';

/**
 * Club badge, loaded from the Premier League CDN. The raster badge is used
 * rather than the SVG so Next can optimise it without the site having to
 * allow remote SVG, which is an XSS surface not worth opening for a crest.
 */
export function Crest({ code, name, size = 28 }: { code: number; name: string; size?: number }) {
  return (
    <Image
      src={badgeUrl(code, 100)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      // Decorative: every use sits beside the club name in text, so announcing
      // the badge as well would just repeat it to a screen reader.
      title={name}
      unoptimized={false}
    />
  );
}
