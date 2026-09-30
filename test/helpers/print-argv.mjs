// Prints the arguments after the script as JSON; used to check how Node.js splits a Windows command line.
process.stdout.write(JSON.stringify(process.argv.slice(2)));
