import Image from 'next/image';
import type { Ground, GroundImage } from '@fpl/core';
import styles from './ground-photo.module.css';

/**
 * A ground, photographed, with its credit attached.
 *
 * The credit is not optional and not a caption the caller can decide to drop:
 * almost every one of these files is Creative Commons with an attribution
 * condition, so the photographer, the licence, and a link to the file page are
 * part of the component rather than part of the page that uses it. There is no
 * prop to turn them off.
 *
 * A ground with no photograph (one, at the time of writing, whose only
 * candidate file carried no readable credit) gets a drawn plate rather than a
 * gap: the ground still exists, and a missing photograph is not a missing
 * ground.
 */
export function GroundPhoto({
  ground,
  image,
  size = 'wide',
  priority = false,
}: {
  ground: Pick<Ground, 'name' | 'city' | 'capacity'>;
  image: GroundImage | undefined;
  size?: 'wide' | 'card';
  priority?: boolean;
}) {
  const dimensions = size === 'wide' ? { width: 960, height: 420 } : { width: 480, height: 260 };

  return (
    <figure className={`${styles.figure} ${styles[size]}`}>
      <div className={styles.frame}>
        {image === undefined ? (
          <div className={styles.fallback} aria-hidden>
            <span className={styles.fallbackName}>{ground.name}</span>
            <span className={styles.fallbackNote}>No freely licensed photograph</span>
          </div>
        ) : (
          <Image
            className={styles.image}
            src={image.imageUrl}
            alt={`${ground.name}${ground.city === null ? '' : `, ${ground.city}`}`}
            width={dimensions.width}
            height={dimensions.height}
            priority={priority}
            sizes={
              size === 'wide'
                ? '(max-width: 60rem) 100vw, 60rem'
                : '(max-width: 40rem) 100vw, 30rem'
            }
          />
        )}
      </div>

      <figcaption className={styles.caption}>
        <span className={styles.name}>
          {ground.name}
          {ground.city !== null && <span className={styles.dim}>, {ground.city}</span>}
          {ground.capacity !== null && (
            <span className={`num ${styles.dim}`}>
              {' '}
              · {ground.capacity.toLocaleString('en-GB')}
            </span>
          )}
        </span>
        {image !== undefined && (
          <span className={styles.credit}>
            <a href={image.sourceUrl} rel="noreferrer">
              Photograph
            </a>{' '}
            by {image.credit},{' '}
            {image.licenceUrl === null ? (
              image.licence
            ) : (
              <a href={image.licenceUrl} rel="license noreferrer">
                {image.licence}
              </a>
            )}
            , via Wikimedia Commons
          </span>
        )}
      </figcaption>
    </figure>
  );
}
