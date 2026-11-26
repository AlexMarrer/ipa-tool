import type { ReactNode } from 'react';
import { Icon, type IconName } from '../theme/icons/Icon';

export type BannerLevel = 'info' | 'warn' | 'err';

export interface BannerProps {
  level?: BannerLevel;
  title?: string;
  children?: ReactNode;
  /** Technical details, collapsed by default (spec AK-10-13). */
  details?: string;
  actions?: ReactNode;
}

const ICON: Record<BannerLevel, IconName> = { info: 'info', warn: 'warning', err: 'warning' };

/** Three levels: information, warning, error. Errors are announced at once, the rest politely. */
export function Banner({ level = 'info', title, children, details, actions }: BannerProps) {
  return (
    <div className={['banner', level === 'info' ? '' : `banner--${level}`].filter(Boolean).join(' ')} role={level === 'err' ? 'alert' : 'status'}>
      <Icon name={ICON[level]} className="banner__icon" />
      <div className="banner__body">
        {title !== undefined ? <div className="banner__title">{title}</div> : null}
        {children !== undefined ? <div>{children}</div> : null}
        {details !== undefined && details !== '' ? (
          <details className="banner__details">
            <summary>Details</summary>
            <pre>{details}</pre>
          </details>
        ) : null}
        {actions !== undefined ? <div className="banner__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
