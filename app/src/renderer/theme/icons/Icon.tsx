import type { SVGProps } from 'react';

/** 16-pixel line icons (spec §10.2): viewBox 0 0 16 16, stroke 1.5, round caps, currentColor. */
const PATHS = {
  bookmark: 'M4 2.5h8v11l-4-3-4 3z',
  calendar: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2v3M10.5 2v3',
  clock: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8 4.5V8l2.5 1.5',
  warning: 'M8 2.5 14.5 13.5h-13zM8 6.5v3.2M8 11.6v.1',
  branch: 'M4.5 2.5v11M4.5 9c0-2 1-3 3.5-3h1.5a2 2 0 0 0 2-2M4.5 2.5v.01M11.5 4v.01M4.5 13.5v.01',
  bulb: 'M6 12.5h4M6.5 14h3M8 2a4 4 0 0 0-2.3 7.3c.5.4.8 1 .8 1.7h3c0-.7.3-1.3.8-1.7A4 4 0 0 0 8 2z',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3',
  spark: 'M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4zM12.5 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  info: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8 7.2V11M8 5v.01',
  'arrow-left': 'M13 8H3M7 4 3 8l4 4',
  'arrow-right': 'M3 8h10M9 4l4 4-4 4',
  plus: 'M8 3v10M3 8h10',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  check: 'M3 8.5 6.5 12 13 4.5',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6',
  'chevron-up': 'M3.5 10 8 5.5 12.5 10',
  folder: 'M2 4.5h4l1.5 1.5H14v7.5H2z',
  settings: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Accessible name; without it the icon is decorative. */
  title?: string;
  size?: number;
}

export function Icon({ name, title, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title === undefined ? undefined : 'img'}
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
      data-icon={name}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
