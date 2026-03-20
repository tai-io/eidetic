#!/usr/bin/env node

// CRITICAL: Redirect console outputs to stderr BEFORE any imports
// Only hook output goes to stdout
console.log = (...args: unknown[]) => {
  process.stderr.write('[LOG] ' + args.join(' ') + '\n');
};
console.warn = (...args: unknown[]) => {
  process.stderr.write('[WARN] ' + args.join(' ') + '\n');
};

async function main() {
  const command = process.argv[2];

  // v2→v3 migration
  if (command === 'migrate') {
    const { runMigration } = await import('./memory/migrate-v3.js');
    runMigration();
    process.exit(0);
  }

  // Hook subcommands: `npx @tai-io/eidetic hook <event>`
  if (command === 'hook') {
    const { runHook } = await import('./hooks/cli-router.js');
    await runHook(process.argv[3]);
    process.exit(0);
  }

  process.stderr.write('Usage: eidetic hook <event> | eidetic migrate\n');
  process.exit(1);
}

process.on('SIGINT', () => {
  process.exit(0);
});

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
