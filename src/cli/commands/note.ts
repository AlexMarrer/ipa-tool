/**
 * `ipa note [text] [optionen]` (spec.md §6.3, package 04): appends a note without taking the lock
 * (D-16) and without a run log entry (spec.md §9.11). The output never repeats the text. Package 06
 * adds the existence check of `--ref` and a secret warning (D-23); `src/notes/` stays independent of both.
 */
import type { Command } from 'commander';
import { type NoteSecretHit, noteSecretHits } from '../../analysis/note-secrets.js';
import { listSnapshots, readManifest } from '../../collector/snapshots.js';
import { resolveContext, type WorkspaceContext } from '../../core/context.js';
import { EXIT, IpaError } from '../../core/errors.js';
import { dayOf } from '../../core/time.js';
import { createSecretScanner } from '../../filter/secret-scanner.js';
import { parseNoteOptions, precheckNoteOptions, type RawNoteOptions, toNoteInput } from '../../notes/input.js';
import { addNote, notesFilePath } from '../../notes/store.js';
import { NOTE_TYPES, type Note, type TimeBasis } from '../../notes/types.js';
import { jsonPath, runAction } from '../action.js';
import { formatFields } from '../format.js';
import type { CliIo, CliState, GlobalOptions } from '../io.js';
import { askNote } from '../note-dialog.js';

interface NoteCommandOptions extends GlobalOptions, RawNoteOptions {
  json?: boolean;
}

const BASIS_LABELS: Record<TimeBasis, string> = { measured: 'gemessen', estimated: 'geschätzt' };

// Without a default value, so that the help shows no English "(default: [])".
function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function formatSavedNote(note: Note): string {
  const rows: [string, string][] = [
    ['Notiz-ID', note.id],
    ['Tag', note.activityDay],
    ['Typ', note.type],
  ];
  if (note.time !== null) {
    const span = note.time.start !== null && note.time.end !== null ? ` (${note.time.start} bis ${note.time.end})` : '';
    rows.push(['Zeit', `${note.time.minutes} Minuten, ${BASIS_LABELS[note.time.basis]}${span}`]);
  }
  if (note.delay !== null) {
    rows.push(['Verzögerung', `${note.delay.minutes} Minuten, ${BASIS_LABELS[note.delay.basis]}, getrennt von der Zeit`]);
  }
  if (note.refs.length > 0) rows.push(['Verweise', note.refs.join(', ')]);
  return `Notiz gespeichert.\n${formatFields(rows)}`;
}

/** Every `--ref` must name evidence of a stored snapshot (D-23), otherwise exit code 2 without a note. */
export async function checkRefsExist(ctx: WorkspaceContext, refs: readonly string[]): Promise<void> {
  const snapshots = new Set(await listSnapshots(ctx));
  for (const ref of refs) {
    const [snapshotId = '', evidenceId] = ref.split(':');
    if (!snapshots.has(snapshotId)) {
      throw new IpaError('ref_unknown', EXIT.usage, `--ref ${ref}: Den Snapshot ${snapshotId} gibt es nicht. Die Notiz wurde nicht gespeichert.`);
    }
    const manifest = await readManifest(ctx, snapshotId);
    if (!manifest.evidence.some((entry) => entry.id === evidenceId)) {
      throw new IpaError('ref_unknown', EXIT.usage, `--ref ${ref}: Snapshot ${snapshotId} hat keinen Beleg ${evidenceId}. Die Notiz wurde nicht gespeichert.`);
    }
  }
}

/** Fields and detectors with a secret hit, never the value (I-12). */
export function noteSecretFindings(ctx: WorkspaceContext, note: Note): NoteSecretHit[] {
  return noteSecretHits(createSecretScanner(ctx.config.secrets), note);
}

/** Warning without the value (I-12); the note stays local and never reaches Claude (spec.md §12.2). */
export function secretWarning(ctx: WorkspaceContext, note: Note): string | null {
  const hits = noteSecretFindings(ctx, note);
  if (hits.length === 0) return null;
  const found = hits.map((hit) => `${hit.detector} in ${hit.field}`).join(', ');
  return (
    `Warnung: Die Notiz ${note.id} enthält möglicherweise ein Zugangsdatum (Detektor ${found}). ` +
    `Sie ist lokal gespeichert, wird aber nie an Claude übermittelt und bleibt eine offene Prüfung. ` +
    `Bei Bedarf in notes/${note.activityDay}.jsonl anpassen.`
  );
}

export function registerNoteCommand(program: Command, io: CliIo, state: CliState): void {
  program
    .command('note')
    .usage('[optionen] [text]')
    .description('Notiz erfassen: Tätigkeit, Problem, Entscheidung, Erkenntnis oder Planung, auf Wunsch mit Zeitaufwand')
    .argument('[text]', 'Text der Notiz; ohne Text fragt der Befehl im Terminal nach')
    .option('--type <typ>', `Notiztyp: ${NOTE_TYPES.join(', ')} (Standard: general)`)
    .option('--day <YYYY-MM-DD>', 'Tätigkeitstag (Standard: heute in der konfigurierten Zeitzone); ein Tag in der Zukunft nur mit --type plan')
    .option('--minutes <n>', 'Zeitaufwand in Minuten, nur mit --measured oder --estimated')
    .option('--start <HH:MM>', 'Beginn, nur zusammen mit --end; die Minuten werden berechnet')
    .option('--end <HH:MM>', 'Ende am selben Tag, nur zusammen mit --start')
    .option('--measured', 'die Zeitangaben sind gemessen')
    .option('--estimated', 'die Zeitangaben sind geschätzt')
    .option('--delay <minuten>', 'Verzögerung in Minuten; wird getrennt gespeichert und nie zur Zeit addiert')
    .option('--reason <text>', 'Grund der Entscheidung (nur mit --type decision)')
    .option('--alternative <text>', 'geprüfte Alternative, mehrfach möglich (nur mit --type decision)', collect)
    .option('--cause <text>', 'Ursache des Problems (nur mit --type problem)')
    .option('--solution <text>', 'Lösung des Problems (nur mit --type problem)')
    .option('--ref <beleg>', 'Verweis auf einen Beleg wie S000001:E001, mehrfach möglich', collect)
    .option('--json', 'Ergebnis als JSON-Objekt auf stdout; der Text ist dann Pflicht')
    .action(async (text: string | undefined, _options: unknown, command: Command) => {
      const options = command.optsWithGlobals<NoteCommandOptions>();
      await runAction({ command: 'note', json: options.json === true, io, state }, async (out) => {
        const ctx = await resolveContext({ repo: options.repo, dataDir: options.dataDir, requireInit: true });
        out.runId = ctx.runId;
        let parsed = parseNoteOptions(options);
        await checkRefsExist(ctx, parsed.refs);
        let noteText = text;
        if (noteText === undefined) {
          const terminal = io.terminal?.();
          if (options.json === true) {
            throw new IpaError(
              'note_needs_text',
              EXIT.usage,
              'Mit --json ist der Text Pflicht, weil der Befehl nicht im Terminal nachfragen kann. Beginnt der Text mit -, steht -- vor ihm.',
            );
          }
          if (terminal === undefined || !terminal.isTTY) {
            throw new IpaError(
              'note_needs_terminal',
              EXIT.usage,
              'Ohne Text fragt ipa note im Terminal nach, das geht nur mit einem Terminal (TTY) für Ein- und Ausgabe. ' +
                'Bitte den Text direkt angeben, zum Beispiel: ipa note "Recherche zur Testkonfiguration"',
            );
          }
          const today = dayOf(ctx.clock.now(), ctx.config.timezone);
          precheckNoteOptions(parsed, today);
          ({ options: parsed, text: noteText } = await askNote(terminal, parsed, { day: parsed.day ?? today, today }));
        }
        const note = await addNote(ctx, toNoteInput(parsed, noteText));
        return {
          exitCode: EXIT.ok,
          result: {
            noteId: note.id,
            type: note.type,
            activityDay: note.activityDay,
            recordedAt: note.recordedAt,
            notePath: jsonPath(notesFilePath(ctx.workspaceDir, note.activityDay)),
            time: note.time,
            delay: note.delay,
            refs: note.refs,
            secretFindings: noteSecretFindings(ctx, note),
          },
          print: () => {
            out.stdout(formatSavedNote(note));
            const warning = secretWarning(ctx, note);
            if (warning !== null) out.warn(warning);
          },
        };
      });
    });
}
