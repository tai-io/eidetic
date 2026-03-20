/**
 * CLI subcommand router for hook events.
 *
 * Plugin bash hooks call `npx @tai-io/eidetic hook <event>` which routes here.
 * Each case dynamically imports the hook module and calls its run() function.
 */

export async function runHook(event: string | undefined): Promise<void> {
  switch (event) {
    case 'cross-project-index': {
      const { run } = await import('./cross-project-index.js');
      run();
      break;
    }
    case 'plan-mode-capture': {
      const { run } = await import('./plan-mode-capture.js');
      await run();
      break;
    }
    case 'precompact':
    case 'session-end': {
      const { run } = await import('../precompact/hook.js');
      await run();
      break;
    }
    case 'tier0-inject': {
      const { run } = await import('../precompact/tier0-inject.js');
      run();
      break;
    }
    default:
      process.stderr.write(`Unknown hook event: ${event ?? '(none)'}\n`);
      process.exit(1);
  }
}
