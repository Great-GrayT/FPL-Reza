import type { MetadataRoute } from 'next';

/**
 * What a phone needs to keep this on a home screen.
 *
 * `display: standalone` is the point of the file: opened from the home screen
 * the site runs without the browser's own chrome, which gives back the address
 * bar and the tab strip, roughly 120 pixels on a phone. Everything else here is
 * what the operating system asks for before it will offer to install anything.
 *
 * The theme colour is the paper the site is printed on rather than an accent,
 * because it is painted behind the status bar and around the safe areas, and an
 * accent there would frame every page in a colour the design rations.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FPL Lake',
    short_name: 'FPL Lake',
    description:
      'Fantasy Premier League players, gameweek by gameweek, the fixtures around them, and a squad solved over a horizon.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#edefe9',
    theme_color: '#edefe9',
    categories: ['sports', 'utilities'],
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png' },
      // Maskable is what stops Android drawing the icon inside a white circle
      // with the artwork shrunk into the middle of it.
      { src: '/icon-maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Build a squad', url: '/builder' },
      { name: 'Plan the season', url: '/planner' },
      { name: 'Players', url: '/players' },
    ],
  };
}
