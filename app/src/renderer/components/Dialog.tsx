import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  /** Called on Ctrl+Enter (spec §8.1: "Strg+Enter bestätigt"). */
  onConfirm?: () => void;
  /** Renders in place without scrim, for the state gallery. */
  inline?: boolean;
  /** 600 px instead of 520 px, for the forms of the actions (spec §8.8). */
  wide?: boolean;
}

/** Modal dialog with focus trap, Esc to close and focus restored to the opener (spec §10.3). */
export function Dialog({ title, children, footer, onClose, onConfirm, inline = false, wide = false }: DialogProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A control marked `data-autofocus` takes the focus, for example the text of a note (spec §8.8).
    const first = root.current?.querySelector<HTMLElement>('[data-autofocus]') ?? root.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root.current)?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Enter' && event.ctrlKey && onConfirm !== undefined) {
      event.preventDefault();
      onConfirm();
      return;
    }
    if (event.key !== 'Tab' || root.current === null) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const dialog = (
    <div
      ref={root}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={['dialog', inline ? 'dialog--inline' : '', wide ? 'dialog--wide' : ''].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      <div className="dialog__body">{children}</div>
      {footer !== undefined ? <div className="dialog__footer">{footer}</div> : null}
    </div>
  );
  if (inline) return dialog;
  return createPortal(<div className="scrim">{dialog}</div>, document.body);
}

export interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /** The confirmation calls Claude: spark icon and tooltip (spec §12.2). */
  confirmAi?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  inline?: boolean;
  /** Second step with an explicit acknowledgement, for example for cost-relevant settings (spec §8.11). */
  secondStep?: { title: string; children: ReactNode; acknowledgeLabel: string; confirmLabel: string };
}

/** Confirmation in one or two steps. The last step confirms with Ctrl+Enter only after the acknowledgement. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Abbrechen', danger, confirmAi = false, onConfirm, onClose, inline, secondStep }: ConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const checkbox = useId();
  const onSecond = step === 2 && secondStep !== undefined;
  const canConfirm = !onSecond || acknowledged;

  const confirm = (): void => {
    if (secondStep !== undefined && step === 1) {
      setStep(2);
      return;
    }
    if (canConfirm) onConfirm();
  };

  return (
    <Dialog
      title={onSecond ? secondStep.title : title}
      onClose={onClose}
      onConfirm={confirm}
      {...(inline !== undefined ? { inline } : {})}
      footer={
        <>
          <span className="dialog__hint">Strg+Enter bestätigt</span>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button variant={danger === true ? 'danger' : 'primary'} ai={confirmAi && (onSecond || secondStep === undefined)} disabled={!canConfirm} onClick={confirm}>
            {onSecond ? secondStep.confirmLabel : secondStep !== undefined ? 'Weiter' : confirmLabel}
          </Button>
        </>
      }
    >
      {onSecond ? (
        <>
          {secondStep.children}
          <p>
            <label htmlFor={checkbox}>
              <input id={checkbox} type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> {secondStep.acknowledgeLabel}
            </label>
          </p>
        </>
      ) : (
        children
      )}
    </Dialog>
  );
}
