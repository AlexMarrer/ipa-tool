import { cloneElement, useCallback, useEffect, useId, useState, type ReactElement } from 'react';

export interface TooltipProps {
  text: string;
  /** One element that can take `aria-describedby`. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/** Shows on hover and keyboard focus, hides on Esc (spec §10.3). The text is linked as description. */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, hide]);

  return (
    <span className="tip-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span id={id} role="tooltip" className={visible ? 'tip' : 'sr-only'}>
        {text}
      </span>
    </span>
  );
}
