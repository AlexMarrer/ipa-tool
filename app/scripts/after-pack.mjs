// electron-builder afterPack hook: flips the Electron fuses (spec §3.2).
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import path from 'node:path';

/** Must match FUSE_POLICY in src/main/security.ts (a test compares them). */
export const FUSES = {
  runAsNode: false,
  enableNodeCliInspectArguments: false,
  enableNodeOptionsEnvironmentVariable: false,
  onlyLoadAppFromAsar: true,
};

export default async function afterPack(context) {
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: FUSES.runAsNode,
    [FuseV1Options.EnableNodeCliInspectArguments]: FUSES.enableNodeCliInspectArguments,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: FUSES.enableNodeOptionsEnvironmentVariable,
    [FuseV1Options.OnlyLoadAppFromAsar]: FUSES.onlyLoadAppFromAsar,
  });
}
