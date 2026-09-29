import picomatch from 'picomatch';

export type PathDecision = { allowed: true } | { allowed: false; rule: string };

export interface PathFilter {
  decide(path: string): PathDecision;
}

export interface PathFilterOptions {
  include: readonly string[];
  exclude: readonly string[];
  /** Workspace path relative to the repository root, if the workspace lies inside the repository. */
  workspace?: string | null;
}

export const GIT_DIR_RULE = '.git/**';
export const NOT_INCLUDED_RULE = 'paths.include';

type Matcher = (path: string) => boolean;

function compile(pattern: string): Matcher {
  const matches = picomatch(pattern, { nocase: true, dot: true });
  if (pattern.includes('/')) return matches;
  // D-10: a pattern without "/" applies to the file name at any depth. picomatch's own
  // `basename` option would also strip the directories from patterns that contain "/".
  return (path) => matches(path.slice(path.lastIndexOf('/') + 1));
}

/**
 * Path filter from spec.md §14.3 for repository paths with "/". Exclusions win over inclusions;
 * `.git` and a workspace inside the repository are always excluded.
 */
export function createPathFilter(options: PathFilterOptions): PathFilter {
  const excludes = options.exclude.map((pattern) => ({ pattern, matches: compile(pattern) }));
  const includes = options.include.map(compile);
  const workspace = options.workspace ? options.workspace.replace(/\/+$/, '') : null;
  const workspaceKey = workspace?.toLowerCase() ?? null;

  return {
    decide(path) {
      if (path.split('/').some((segment) => segment.toLowerCase() === '.git')) {
        return { allowed: false, rule: GIT_DIR_RULE };
      }
      if (workspaceKey !== null) {
        const key = path.toLowerCase();
        if (key === workspaceKey || key.startsWith(`${workspaceKey}/`)) {
          return { allowed: false, rule: `${workspace}/**` };
        }
      }
      for (const { pattern, matches } of excludes) {
        if (matches(path)) return { allowed: false, rule: pattern };
      }
      if (!includes.some((matches) => matches(path))) return { allowed: false, rule: NOT_INCLUDED_RULE };
      return { allowed: true };
    },
  };
}
