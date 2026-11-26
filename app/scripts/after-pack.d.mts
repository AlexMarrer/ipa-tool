export const FUSES: {
  runAsNode: boolean;
  enableNodeCliInspectArguments: boolean;
  enableNodeOptionsEnvironmentVariable: boolean;
  onlyLoadAppFromAsar: boolean;
};
export default function afterPack(context: { appOutDir: string; packager: { appInfo: { productFilename: string } } }): Promise<void>;
