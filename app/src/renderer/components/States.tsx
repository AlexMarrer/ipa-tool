import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Banner } from './Banner';

/** True only after `active` has lasted `delayMs`; short loads show no skeleton (spec AK-10-13: 150 ms). */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

export function Skeleton({ lines = 3, label = 'Wird geladen' }: { lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: 'grid', gap: 10 }}>
      {Array.from({ length: lines }, (_unused, index) => (
        <div key={index} className="skeleton" style={{ width: `${90 - index * 15}%` }} />
      ))}
    </div>
  );
}

/** Skeleton that appears only for loads longer than 150 ms. */
export function LoadingSkeleton({ loading, lines }: { loading: boolean; lines?: number }) {
  const visible = useDelayedFlag(loading);
  return visible ? <Skeleton {...(lines !== undefined ? { lines } : {})} /> : null;
}

export interface EmptyStateProps {
  title: string;
  /** One sentence. */
  text: string;
  /** The single main action. */
  action?: ReactNode;
}

export function EmptyState({ title, text, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      <p className="empty__text">{text}</p>
      {action}
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Name of the area, shown in the message. */
  area?: string;
}
interface BoundaryState {
  error: Error | null;
}

/** Error boundary around every page: one failing component does not take the app down (spec AK-10-13). */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Rendering errors are shown, not reported anywhere: the app makes no network calls (spec §12.5).
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <Banner
        level="err"
        title={`${this.props.area ?? 'Dieser Bereich'} konnte nicht angezeigt werden`}
        details={this.state.error.message}
        actions={
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Erneut anzeigen
          </button>
        }
      >
        Die übrige App funktioniert weiter. Wechsle den Bereich oder versuche es erneut.
      </Banner>
    );
  }
}
