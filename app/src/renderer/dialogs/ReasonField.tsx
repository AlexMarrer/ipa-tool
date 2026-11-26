import { useEffect, useState } from 'react';
import type { IpaApi } from '../../shared/ipc';
import { detectorPhrase } from '../../shared/run-texts';
import { Field } from '../components';

export const MAX_REASON = 2000;

export interface ReasonState {
  value: string;
  setValue: (value: string) => void;
  /** Detector names that hit in the reason; never the value. */
  detectors: string[];
  /** Why confirming is locked, or `null`. */
  blocked: string | null;
}

/**
 * The reason of an action: required and checked for secrets before it is sent (spec §8.9). The check only names
 * the detector; the CLI checks the same text again and its answer wins.
 */
export function useReason(api: IpaApi, repositoryId: string): ReasonState {
  const [value, setValue] = useState('');
  const [detectors, setDetectors] = useState<string[]>([]);
  const [checked, setChecked] = useState('');

  useEffect(() => {
    if (value.trim() === '') {
      setDetectors([]);
      setChecked(value);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api.config.scanText(repositoryId, value).then((result) => {
        if (!live) return;
        setDetectors(result.ok ? result.value.detectors : []);
        setChecked(value);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, repositoryId, value]);

  const empty = value.trim() === '';
  const blocked = empty
    ? 'Bestätigen gesperrt: Der Grund fehlt.'
    : checked !== value
      ? 'Bestätigen gesperrt: Der Grund wird geprüft.'
      : detectors.length > 0
        ? 'Bestätigen gesperrt: Der Grund enthält einen Geheimwert.'
        : null;
  return { value, setValue, detectors, blocked };
}

export interface ReasonFieldProps {
  reason: ReasonState;
  /** Message of the CLI for this field (exit code 2), which wins over the pre-check. */
  serverError?: string | null;
  label?: string;
}

export function ReasonField({ reason, serverError = null, label = 'Grund' }: ReasonFieldProps) {
  const [touched, setTouched] = useState(false);
  const hit = reason.detectors[0];
  const error =
    hit !== undefined
      ? `Der Grund wurde nicht übernommen: Er enthält ${detectorPhrase(hit)} (Detektor ${hit}). Der Wert wird weder angezeigt noch gespeichert. Formuliere den Grund ohne Zugangsdaten.`
      : serverError !== null
        ? serverError
        : touched && reason.value.trim() === ''
          ? 'Ohne Grund lässt sich dies nicht bestätigen.'
          : undefined;
  return (
    <Field label={`${label} (Pflicht)`} {...(error === undefined ? { hint: 'Ohne Grund lässt sich dies nicht bestätigen.' } : { error })}>
      {(control) => (
        <textarea
          {...control}
          className="textarea"
          rows={3}
          maxLength={MAX_REASON}
          value={reason.value}
          onChange={(event) => reason.setValue(event.target.value)}
          onBlur={() => setTouched(true)}
        />
      )}
    </Field>
  );
}
