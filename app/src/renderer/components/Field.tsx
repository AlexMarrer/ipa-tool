import { useId, type ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: (props: FieldControlProps) => ReactNode;
}

/** Label, hint and error linked to the control (spec §10.3). The control comes as a render function. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const described = [hint !== undefined ? hintId : null, error !== undefined ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': described === '' ? undefined : described, 'aria-invalid': error !== undefined ? true : undefined })}
      {hint !== undefined ? (
        <div id={hintId} className="field__hint">
          {hint}
        </div>
      ) : null}
      {error !== undefined ? (
        <div id={errorId} className="field__error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
