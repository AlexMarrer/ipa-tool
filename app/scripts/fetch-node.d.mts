export function sha256Of(file: string): Promise<string>;
export function archiveUrl(version: string): string;
export function fetchNode(options: {
  version: string;
  sha256: string;
  targetDir: string;
  download?: (url: string, file: string) => Promise<void>;
  extract?: (zipFile: string, version: string, targetDir: string) => void;
}): Promise<{ sha256: string; file: string }>;
