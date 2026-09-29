/**
 * `doctor.json` (spec.md §9.13) and the decisions the runner derives from it.
 */
import path from 'node:path';
import type { Config } from '../core/config.js';
import { IpaError } from '../core/errors.js';
import { readJsonValidated, writeJsonAtomic } from '../core/json.js';
import { requiredFlags } from './args.js';
import type { DoctorRecord, ProbedFlag } from './types.js';

export const DOCTOR_FILE = 'doctor.json';

export function doctorPath(workspaceDir: string): string {
  return path.join(workspaceDir, DOCTOR_FILE);
}

/** `null` without a doctor result; an invalid file ends with exit code 2 like every other file (spec.md §8.4). */
export async function readDoctorRecord(workspaceDir: string): Promise<DoctorRecord | null> {
  try {
    return await readJsonValidated<DoctorRecord>(doctorPath(workspaceDir), 'doctor');
  } catch (error) {
    if (error instanceof IpaError && error.code === 'file_not_found') return null;
    throw error;
  }
}

export async function writeDoctorRecord(workspaceDir: string, record: DoctorRecord): Promise<void> {
  await writeJsonAtomic(doctorPath(workspaceDir), record, 'doctor');
}

export function missingRequiredFlags(record: DoctorRecord, config: Pick<Config, 'claude'>): ProbedFlag[] {
  return requiredFlags(config).filter((flag) => record.claude.flags[flag] !== true);
}

/** Packages 06 and 07 call Claude only if this holds (package 05 §4). */
export function claudeUsable(record: DoctorRecord, config: Pick<Config, 'claude'>): boolean {
  return record.claude.found && missingRequiredFlags(record, config).length === 0;
}

/** A-08: only after a live check confirmed that the login keeps working (spec.md §13.1). */
export function usesSettingSources(record: DoctorRecord | null): boolean {
  return record !== null && record.claude.settingSourcesAuthOk === true && record.claude.flags['--setting-sources'] === true;
}

export function usesSafeMode(record: DoctorRecord | null): boolean {
  return record !== null && record.claude.flags['--safe-mode'] === true;
}
