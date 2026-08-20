'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The gameweek the whole player page is looking at.
 *
 * The ribbon sits in the main column and the movement figure sits in the
 * sidebar beside the season totals, so the selection cannot live in either of
 * them. It is one reader looking at one week, and both objects answer to it:
 * pressing a cell in the ribbon narrows the figure, and the figure's own
 * controls move the ribbon's mark.
 */
interface PlayerFocus {
  gameweek: number | null;
  select: (gameweek: number | null) => void;
}

const Context = createContext<PlayerFocus>({ gameweek: null, select: () => undefined });

export function PlayerFocusProvider({ children }: { children: ReactNode }) {
  const [gameweek, setGameweek] = useState<number | null>(null);
  const value = useMemo<PlayerFocus>(() => ({ gameweek, select: setGameweek }), [gameweek]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePlayerFocus(): PlayerFocus {
  return useContext(Context);
}
