import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AI_MARK_TOOLTIP } from '../../shared/messages';
import { Icon, type IconName } from '../theme/icons/Icon';
import { Tooltip } from './Tooltip';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** The button can call Claude: spark icon, tooltip and the word "Claude" in the accessible name (spec §12.2). */
  ai?: boolean;
  icon?: IconName;
  /** Why the button is disabled; shown as tooltip (spec §3.7). */
  disabledReason?: string;
}

export function Button({ variant = 'secondary', ai = false, icon, disabledReason, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  const button = (
    <button type={type} className={['btn', `btn--${variant}`, className].filter(Boolean).join(' ')} disabled={disabled} {...rest}>
      {ai ? <Icon name="spark" /> : icon !== undefined ? <Icon name={icon} /> : null}
      {children}
      {ai ? <span className="sr-only"> ({AI_MARK_TOOLTIP})</span> : null}
    </button>
  );
  const tip = disabled === true && disabledReason !== undefined ? disabledReason : ai ? AI_MARK_TOOLTIP : null;
  return tip === null ? button : <Tooltip text={tip}>{button}</Tooltip>;
}

export interface SplitMenuItem {
  id: string;
  label: ReactNode;
  ai?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface SplitButtonProps {
  label: ReactNode;
  ai?: boolean;
  variant?: ButtonProps['variant'];
  disabled?: boolean;
  disabledReason?: string;
  /** Disables only the menu, for example when the main action is unavailable but the variants are not. Defaults to `disabled`. */
  menuDisabled?: boolean;
  /** The main button only: locked while the menu stays usable. */
  mainDisabled?: boolean;
  onClick: () => void;
  items: SplitMenuItem[];
  menuLabel?: string;
}

/** Main action plus a menu with variants, for example "Jetzt erfassen" and "Nur aufnehmen" (spec §8.7). */
export function SplitButton({ label, ai = false, variant = 'secondary', disabled, disabledReason, menuDisabled, mainDisabled, onClick, items, menuLabel = 'Weitere Optionen' }: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <span className="split" ref={root}>
      <Button variant={variant} ai={ai} disabled={disabled === true || mainDisabled === true} {...(disabledReason !== undefined ? { disabledReason } : {})} onClick={onClick}>
        {label}
      </Button>
      <button
        type="button"
        className={`btn btn--${variant}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuLabel}
        disabled={menuDisabled ?? disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="chevron-down" />
      </button>
      {open ? (
        <div className="menu" role="menu">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="menu__item"
              disabled={item.disabled === true}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.ai === true ? <Icon name="spark" /> : null}
              {item.label}
              {item.ai === true ? <span className="sr-only"> ({AI_MARK_TOOLTIP})</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
