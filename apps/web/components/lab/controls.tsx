'use client';

/**
 * The Lab's controls. Every one of them is a plain form element with a visible
 * label: a dense workspace is exactly where an unlabelled icon button becomes
 * unusable, and every control here has to be reachable from a keyboard.
 */
import { useId, type ReactNode } from 'react';
import styles from './controls.module.css';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}): React.ReactElement {
  const id = useId();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint === undefined ? null : <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

export function Select({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  hint?: string;
}): React.ReactElement {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(id) => (
        <select
          id={id}
          className={styles.select}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}): React.ReactElement {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(id) => (
        <input
          id={id}
          type="number"
          className={`${styles.input} num`}
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
        />
      )}
    </Field>
  );
}

/**
 * A formula input. The error is shown under the field with the position the
 * parser reported, because "unexpected token" with no location is the least
 * useful message an expression language can give.
 */
export function FormulaField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: string;
  placeholder?: string;
}): React.ReactElement {
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      {(id) => (
        <>
          <input
            id={id}
            type="text"
            spellCheck={false}
            autoComplete="off"
            className={`${styles.input} ${styles.formula} ${error != null ? styles.inputError : ''}`}
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            aria-invalid={error != null}
          />
          {error == null ? null : <p className={styles.error}>{error}</p>}
        </>
      )}
    </Field>
  );
}

export function Chips({
  label,
  values,
  selected,
  onToggle,
  hint,
}: {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
  hint?: string;
}): React.ReactElement {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.chips} role="group" aria-label={label}>
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={styles.chip}
              data-active={active}
              aria-pressed={active}
              onClick={() => {
                onToggle(value);
              }}
            >
              {value}
            </button>
          );
        })}
      </div>
      {hint === undefined ? null : <p className={styles.hint}>{hint}</p>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  tone = 'quiet',
  type = 'button',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'quiet' | 'loud';
  type?: 'button' | 'submit';
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type={type}
      className={styles.button}
      data-tone={tone}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function StatGrid({
  stats,
}: {
  stats: { label: string; value: string; note?: string; tone?: 'plain' | 'good' | 'warn' }[];
}): React.ReactElement {
  return (
    <dl className={styles.stats}>
      {stats.map((stat) => (
        <div key={stat.label} className={styles.stat} data-tone={stat.tone ?? 'plain'}>
          <dt className={styles.statLabel}>{stat.label}</dt>
          <dd className={`${styles.statValue} num`}>{stat.value}</dd>
          {stat.note === undefined ? null : <p className={styles.statNote}>{stat.note}</p>}
        </div>
      ))}
    </dl>
  );
}

/**
 * The sentence beside a number. Nothing in this workspace prints a statistic
 * without one: a coefficient with no statement of what it licenses is how a
 * dashboard misleads a careful reader.
 */
export function Verdict({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'good' | 'warn';
}): React.ReactElement {
  return (
    <p className={styles.verdict} data-tone={tone}>
      {children}
    </p>
  );
}

export function Section({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}): React.ReactElement {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {aside}
      </header>
      {description === undefined ? null : (
        <p className={styles.sectionDescription}>{description}</p>
      )}
      {children}
    </section>
  );
}

export function Loading({ label }: { label: string }): React.ReactElement {
  return (
    <p className={styles.loading} role="status">
      {label}
    </p>
  );
}

export function Failure({ message }: { message: string }): React.ReactElement {
  return (
    <p className={styles.failure} role="alert">
      {message}
    </p>
  );
}
