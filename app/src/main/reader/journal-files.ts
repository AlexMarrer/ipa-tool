import { copyFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FinalFileView, RemoveResult } from '../../shared/views';
import type { ShellPort } from '../shell';

export const DRAFT_NAME = /^(\d{4}-\d{2}-\d{2})-(R\d{8}T\d{6}Z-[0-9a-f]{4})$/;
/** A final file starts with its day; the rest of the name is the user's. */
// eslint-disable-next-line no-control-regex
export const FINAL_NAME = /^\d{4}-\d{2}-\d{2}[^\\/:*?"<>|\u0000-\u001f]{0,100}\.md$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COPIES = 99;
/** `fs.constants.COPYFILE_EXCL`: fail instead of replacing a file that exists. */
const COPYFILE_EXCL = 1;

export type FinalizeResult = { ok: true; file: string } | { ok: false; problem: string };

export interface JournalFiles {
  finals(day: string): Promise<FinalFileView[]>;
  /** Copies a draft to `journal/final/<day>.md`; a taken name gets a number, an existing file is never replaced. */
  finalize(draft: string): Promise<FinalizeResult>;
  /** Draft (with its record) or final file to the recycle bin. */
  remove(kind: 'draft' | 'final', file: string): Promise<RemoveResult>;
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

/**
 * The only place where the app changes files of a workspace, and only on the user's request (spec §4.3): a copy into
 * `journal/final/` and moving drafts or final files to the recycle bin. Nothing is overwritten, nothing is deleted
 * for good, and no path comes from the renderer.
 */
export function createJournalFiles(workspacePath: string, shell: Pick<ShellPort, 'trashItem'>): JournalFiles {
  const drafts = path.join(workspacePath, 'journal', 'drafts');
  const finalDir = path.join(workspacePath, 'journal', 'final');

  /** The real path of an existing file, only if it stays inside `folder` (spec §3.8). */
  async function inside(folder: string, target: string): Promise<string | null> {
    try {
      const [real, root] = await Promise.all([realpath(target), realpath(folder)]);
      const relative = path.relative(root, real);
      return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) ? real : null;
    } catch {
      return null;
    }
  }

  return {
    async finals(day) {
      if (!DAY.test(day)) return [];
      let names: string[];
      try {
        names = await readdir(finalDir);
      } catch {
        return [];
      }
      const found: FinalFileView[] = [];
      for (const name of names.sort()) {
        if (!name.startsWith(day) || !FINAL_NAME.test(name) || name.includes('..')) continue;
        const file = path.join(finalDir, name);
        if (!(await isFile(file))) continue;
        found.push({ file: name, modifiedAt: (await stat(file)).mtime.toISOString() });
      }
      return found;
    },

    async finalize(draft) {
      const match = DRAFT_NAME.exec(draft);
      if (match === null) return { ok: false, problem: 'Dieser Entwurf ist nicht gültig benannt.' };
      const source = await inside(drafts, path.join(drafts, `${draft}.md`));
      if (source === null) return { ok: false, problem: 'Der Entwurf wurde nicht gefunden.' };
      const day = match[1] as string;
      await mkdir(finalDir, { recursive: true });
      for (let copy = 1; copy <= MAX_COPIES; copy++) {
        const name = copy === 1 ? `${day}.md` : `${day}-${copy}.md`;
        try {
          await copyFile(source, path.join(finalDir, name), COPYFILE_EXCL);
          return { ok: true, file: name };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
          return { ok: false, problem: 'Die Endfassung konnte nicht angelegt werden. Prüfe, ob journal/final/ beschreibbar ist.' };
        }
      }
      return { ok: false, problem: `Für diesen Tag gibt es schon ${MAX_COPIES} Endfassungen.` };
    },

    async remove(kind, file) {
      const targets: string[] = [];
      if (kind === 'draft') {
        if (!DRAFT_NAME.test(file)) return { removed: false, problem: 'Dieser Entwurf ist nicht gültig benannt.' };
        for (const extension of ['md', 'json']) {
          const real = await inside(drafts, path.join(drafts, `${file}.${extension}`));
          if (real !== null) targets.push(real);
        }
      } else {
        if (!FINAL_NAME.test(file) || file.includes('..')) return { removed: false, problem: 'Diese Datei ist nicht gültig benannt.' };
        const real = await inside(finalDir, path.join(finalDir, file));
        if (real !== null) targets.push(real);
      }
      if (targets.length === 0) return { removed: false, problem: 'Die Datei wurde nicht gefunden.' };
      try {
        for (const target of targets) await shell.trashItem(target);
      } catch {
        return { removed: false, problem: 'Die Datei liess sich nicht in den Papierkorb verschieben. Sie bleibt unverändert.' };
      }
      return { removed: true, problem: null };
    },
  };
}
