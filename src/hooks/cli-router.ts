/**
 * CLI subcommand router for hook events.
 *
 * Plugin bash hooks call `npx @tai-io/eidetic hook <event>` which routes here.
 * Each case dynamically imports the hook module and calls its run() function.
 */

export async function runHook(event: string | undefined): Promise<void> {
  switch (event) {
    case 'post-tool-extract': {
      const { run } = await import('./post-tool-extract.js');
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
    case 'memory-inject': {
      const { run } = await import('../precompact/memory-inject.js');
      await run();
      break;
    }
    case 'setup-message': {
      const mode = process.argv[4] ?? 'welcome';
      const detail = process.argv[5];
      const { getSetupErrorMessage, getWelcomeMessage } = await import('../setup-message.js');
      if (mode === 'welcome') {
        const output = {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: getWelcomeMessage(),
          },
        };
        process.stdout.write(JSON.stringify(output));
      } else {
        const output = {
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: getSetupErrorMessage(
              detail || 'OPENAI_API_KEY is not set.',
              mode as 'missing' | 'invalid' | 'unknown',
            ),
          },
        };
        process.stdout.write(JSON.stringify(output));
      }
      break;
    }
    default:
      process.stderr.write(`Unknown hook event: ${event ?? '(none)'}\n`);
      process.exit(1);
  }
}
