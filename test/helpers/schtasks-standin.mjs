// Stand-in for `schtasks` in the runner test: the first argument selects the behaviour.
// It never touches the Task Scheduler.
const [mode, ...rest] = process.argv.slice(2);

if (mode === 'args') {
  process.stdout.write(JSON.stringify(rest));
} else if (mode === 'oem') {
  // "Nächste" in the OEM code page 850, then a character that no single-byte page has as `?`.
  process.stdout.write(Buffer.from([0x4e, 0x84, 0x63, 0x68, 0x73, 0x74, 0x65, 0x0d, 0x0a]));
  process.stderr.write(Buffer.from('FEHLER: Zugriff verweigert \x81\r\n', 'latin1'));
} else if (mode === 'exit') {
  process.stderr.write('FEHLER: Das System kann die angegebene Datei nicht finden.\r\n');
  process.exit(Number(rest[0]));
} else if (mode === 'hang') {
  setInterval(() => undefined, 1000);
}
