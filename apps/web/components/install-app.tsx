'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './install-app.module.css';

/**
 * Put this on a phone.
 *
 * Installed from a home screen the site runs without the browser's own chrome,
 * which gives back the address bar and the tab strip: about 120 pixels on a
 * phone, on top of the 158 the navigation gave back. That is most of a fixture
 * list.
 *
 * The three platforms disagree about how this works, so this says three
 * different things rather than one thing that is wrong on two of them. Chrome
 * and Edge fire `beforeinstallprompt`, which can be held and replayed on a
 * press, and that is the only path where a button can actually install
 * anything. Safari on iOS fires nothing and has no API at all: the only way is
 * the Share menu, so what a reader gets there is the instruction. And a desktop
 * browser can install it too, but the thing a reader on a desktop usually wants
 * is the site on the phone in their pocket, so that path offers the address.
 *
 * Where the site is already installed it renders nothing. A button offering to
 * install what you are running inside is a button that has not looked.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Mode = 'unknown' | 'prompt' | 'ios' | 'manual' | 'installed';

export function InstallApp({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<Mode>('unknown');
  const [held, setHeld] = useState<InstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setUrl(window.location.origin);

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // Safari's own flag, which predates the standard media query and is
      // still the only thing that answers on an installed iOS site.
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setMode('installed');
      return;
    }

    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // An iPad says Macintosh and has a touch screen, which no Mac does. That
      // pair is the only reliable way to tell the two apart, now that
      // navigator.platform is deprecated.
      (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    setMode(isIOS ? 'ios' : 'manual');

    const onPrompt = (event: Event): void => {
      // Holding the event is what lets the install happen on a press rather
      // than whenever the browser decides to ask.
      event.preventDefault();
      setHeld(event as InstallPromptEvent);
      setMode('prompt');
    };
    const onInstalled = (): void => {
      setMode('installed');
      setOpen(false);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(() => {
    if (held === null) {
      setOpen((current) => !current);
      return;
    }
    void held.prompt().then(async () => {
      const choice = await held.userChoice;
      if (choice.outcome === 'accepted') setMode('installed');
      // A held prompt can only be replayed once, so it goes either way.
      setHeld(null);
    });
  }, [held]);

  const copy = useCallback(() => {
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => {
          setCopied(false);
        }, 2000);
      })
      .catch(() => {
        setCopied(false);
      });
  }, [url]);

  if (mode === 'installed' || mode === 'unknown') return null;

  return (
    <div className={compact ? styles.compact : styles.wrap}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={mode === 'prompt' ? undefined : open}
        aria-controls={mode === 'prompt' ? undefined : 'install-help'}
        onClick={install}
      >
        {mode === 'prompt' ? 'Add to home screen' : 'Get the app'}
      </button>

      {open && mode !== 'prompt' && (
        <div id="install-help" className={styles.panel}>
          {mode === 'ios' ? (
            <>
              <p className={styles.head}>On this iPhone or iPad</p>
              <ol className={styles.steps}>
                <li>
                  Press <strong>Share</strong> in Safari&rsquo;s toolbar, the square with an arrow
                  out of it.
                </li>
                <li>
                  Scroll down and choose <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  Press <strong>Add</strong>. It opens without Safari&rsquo;s toolbars after that.
                </li>
              </ol>
              <p className={styles.note}>
                Safari has no button that can do this for you, which is why these are instructions
                rather than a control.
              </p>
            </>
          ) : (
            <>
              <p className={styles.head}>Open it on your phone</p>
              <p className={styles.note}>
                Visit this address on the phone, then use Add to Home Screen in Safari or Install
                app in Chrome.
              </p>
              <p className={styles.address}>
                <span className={`num ${styles.url}`}>{url}</span>
                <button type="button" className={styles.copy} onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
