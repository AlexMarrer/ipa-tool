/**
 * Interactive input of `ipa note` without text (package 04 §4). The questions come in a fixed order,
 * each with a default that Enter takes over. Options given on the command line count as answered and
 * their questions are skipped; an invalid answer is asked again.
 */
import { createInterface } from 'node:readline';
import { EXIT, IpaError } from '../core/errors.js';
import { type NoteOptions, parseMinutes, precheckNoteOptions } from '../notes/input.js';
import { NOTE_TYPES, type NoteType, type TimeBasis } from '../notes/types.js';
import type { TerminalIo } from './io.js';

export interface NoteDialogResult {
  options: NoteOptions;
  text: string;
}

const TYPE_QUESTION = `Typ (${NOTE_TYPES.map((type, index) => `${index + 1} ${type}`).join(', ')}) [general]: `;

const BASIS_ANSWERS = new Map<string, TimeBasis>([
  ['g', 'measured'],
  ['gemessen', 'measured'],
  ['measured', 'measured'],
  ['s', 'estimated'],
  ['geschätzt', 'estimated'],
  ['geschaetzt', 'estimated'],
  ['estimated', 'estimated'],
]);

/** Number, name or empty for the default `general`; `null` if nothing matches. */
function parseTypeAnswer(answer: string): NoteType | null {
  if (answer === '') return 'general';
  if (/^[1-9]$/.test(answer)) return NOTE_TYPES[Number(answer) - 1] ?? null;
  const name = answer.toLowerCase();
  return NOTE_TYPES.find((type) => type === name) ?? null;
}

/** Answer of the time question; `null` means no time given. */
function parseDurationAnswer(answer: string): number | null {
  return answer === '' ? null : parseMinutes('Der Zeitaufwand', answer);
}

function aborted(): IpaError {
  return new IpaError('note_input_aborted', EXIT.usage, 'Eingabe abgebrochen. Es wurde keine Notiz gespeichert.');
}

export async function askNote(terminal: TerminalIo, preset: NoteOptions, days: { day: string; today: string }): Promise<NoteDialogResult> {
  const { output } = terminal;
  const rl = createInterface({ input: terminal.input, output, terminal: (output as { isTTY?: boolean }).isTTY === true });
  // The iterator buffers lines that arrive before their question, for example from a pipe, and still
  // delivers them after readline has closed at the end of the input.
  const lines = rl[Symbol.asyncIterator]();
  let closed = false;
  rl.once('close', () => {
    closed = true;
  });
  const say = (text: string): void => {
    output.write(`${text}\n`);
  };
  const ask = async (question: string): Promise<string> => {
    if (closed) {
      // From Node.js 24 on, prompt() throws ERR_USE_AFTER_CLOSE on a closed interface.
      output.write(question);
    } else {
      rl.setPrompt(question);
      rl.prompt();
    }
    const next = await lines.next();
    if (next.done === true) {
      // Ends the open prompt line, so that the error message starts on a line of its own.
      output.write('\n');
      throw aborted();
    }
    return next.value.trim();
  };
  /** Asks until `parse` accepts the answer; an `IpaError` from `parse` is shown and asked again. */
  const askUntil = async <T>(question: string, parse: (answer: string) => T, hint: string): Promise<T> => {
    for (;;) {
      const answer = await ask(question);
      try {
        return parse(answer);
      } catch (error) {
        if (!(error instanceof IpaError)) throw error;
        say(hint === '' ? error.message : hint);
      }
    }
  };

  try {
    const options: NoteOptions = { ...preset, alternatives: [...preset.alternatives], refs: [...preset.refs] };
    say(`Neue Notiz für ${days.day}. Enter übernimmt den Standardwert, Strg+C bricht ab.`);

    if (options.type === undefined) {
      options.type = await askUntil(
        TYPE_QUESTION,
        (answer) => {
          const type = parseTypeAnswer(answer);
          if (type === null) throw new IpaError('note_type_invalid', EXIT.usage, 'Bitte einen der Typen oder seine Nummer eingeben.');
          // Options from the command line may only fit some types, for example --reason.
          precheckNoteOptions({ ...options, type }, days.today);
          return type;
        },
        '',
      );
    }

    const text = await askUntil(
      'Text: ',
      (answer) => {
        if (answer === '') throw new IpaError('note_text_empty', EXIT.usage, 'Der Text ist Pflicht.');
        return answer;
      },
      '',
    );

    if (options.type === 'decision') {
      if (options.reason === undefined) {
        const reason = await ask('Grund (Enter = unbekannt): ');
        if (reason !== '') options.reason = reason;
      }
      if (options.alternatives.length === 0) {
        let alternative = await ask('Geprüfte Alternative (Enter = keine): ');
        while (alternative !== '') {
          options.alternatives.push(alternative);
          alternative = await ask('Weitere Alternative (Enter = keine weitere): ');
        }
      }
    } else if (options.type === 'problem') {
      if (options.cause === undefined) {
        const cause = await ask('Ursache (Enter = unbekannt): ');
        if (cause !== '') options.cause = cause;
      }
      if (options.solution === undefined) {
        const solution = await ask('Lösung (Enter = unbekannt): ');
        if (solution !== '') options.solution = solution;
      }
    }

    if (options.duration === undefined) {
      const minutes = await askUntil(
        'Zeitaufwand in Minuten (Enter = keine Angabe): ',
        parseDurationAnswer,
        'Bitte eine ganze Zahl grösser als 0 eingeben oder mit Enter überspringen.',
      );
      if (minutes !== null) options.duration = { minutes, start: null, end: null };
    }

    if (options.basis === undefined && (options.duration !== undefined || options.delayMinutes !== undefined)) {
      options.basis = await askUntil(
        'Gemessen oder geschätzt? (g/s): ',
        (answer) => {
          const basis = BASIS_ANSWERS.get(answer.toLowerCase());
          if (basis === undefined) throw new IpaError('note_basis_missing', EXIT.usage, 'Bitte g für gemessen oder s für geschätzt eingeben.');
          return basis;
        },
        '',
      );
    }
    return { options, text };
  } finally {
    rl.close();
  }
}
