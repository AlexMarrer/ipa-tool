import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  label: string;
  tabs: TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** Content of the selected tab. */
  children?: ReactNode;
}

/** Tabs with the ARIA tab pattern: arrow keys, Home and End move, roving tabindex (spec §10.3). */
export function Tabs({ label, tabs, selected, onSelect, children }: TabsProps) {
  const base = useId();
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const move = (event: KeyboardEvent, index: number): void => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (target === undefined) return;
    onSelect(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div>
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element !== null) refs.current.set(tab.id, element);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={tab.id === selected}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={tab.id === selected ? 0 : -1}
            className="tab"
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <>
                {/* The space keeps the accessible name readable: "Work-Logs 5". */}
                {' '}
                <span className="tab__count">{tab.count}</span>
              </>
            ) : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel-${selected}`} aria-labelledby={`${base}-tab-${selected}`} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
