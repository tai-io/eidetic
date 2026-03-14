import { describe, it, expect } from 'vitest';
import { extractFacts } from '../post-tool-extract.js';

describe('extractFacts', () => {
  describe('Read tool', () => {
    it('captures file path from Read tool', () => {
      const facts = extractFacts('Read', { file_path: '/src/index.ts' }, 'file contents...');
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe('Read file: /src/index.ts');
      expect(facts[0].files).toEqual(['/src/index.ts']);
    });
  });

  describe('Edit tool', () => {
    it('captures file path from Edit tool', () => {
      const facts = extractFacts('Edit', { file_path: '/src/utils.ts' }, 'edited successfully');
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe('Edited file: /src/utils.ts');
      expect(facts[0].files).toEqual(['/src/utils.ts']);
    });
  });

  describe('Write tool', () => {
    it('captures file path from Write tool', () => {
      const facts = extractFacts('Write', { file_path: '/src/new.ts' }, 'written');
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe('Wrote file: /src/new.ts');
      expect(facts[0].files).toEqual(['/src/new.ts']);
    });
  });

  describe('Grep tool', () => {
    it('captures pattern and path from Grep tool', () => {
      const facts = extractFacts('Grep', { pattern: 'TODO', path: '/src' }, 'matches found');
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe("Searched for 'TODO' in /src");
      expect(facts[0].files).toEqual(['/src']);
    });
  });

  describe('Glob tool', () => {
    it('captures pattern from Glob tool', () => {
      const facts = extractFacts('Glob', { pattern: '**/*.ts' }, 'files found');
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toBe("Searched for files matching '**/*.ts'");
      expect(facts[0].files).toEqual([]);
    });
  });

  describe('WebFetch tool', () => {
    it('captures 404 from WebFetch', () => {
      const facts = extractFacts(
        'WebFetch',
        { url: 'https://example.com' },
        'Error: 404 not found',
      );
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toContain('404');
      expect(facts[0].files).toEqual([]);
    });

    it('captures successful fetch snippet', () => {
      const longContent = 'This is a documentation page about the API. '.repeat(10);
      const facts = extractFacts('WebFetch', { url: 'https://docs.example.com' }, longContent);
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toContain('https://docs.example.com');
    });
  });

  describe('Bash tool', () => {
    it('captures install commands', () => {
      const facts = extractFacts('Bash', { command: 'npm install lodash' }, 'added 1 package');
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toContain('lodash');
    });

    it('captures command errors', () => {
      const facts = extractFacts(
        'Bash',
        { command: 'npm test' },
        'Error: test failed\nexit code 1',
      );
      expect(facts).toHaveLength(1);
      expect(facts[0].fact).toContain('failed');
    });

    it('filters out noisy shell environment errors', () => {
      const facts = extractFacts(
        'Bash',
        { command: 'echo hello' },
        'conda: command not found\nhello',
      );
      // Should not capture conda noise as a fact
      expect(facts).toHaveLength(0);
    });

    it('filters out CRLF warnings', () => {
      const facts = extractFacts(
        'Bash',
        { command: 'git add .' },
        'warning: CRLF will be replaced by LF in file.txt',
      );
      expect(facts).toHaveLength(0);
    });
  });

  describe('source field', () => {
    it('returns file-context source for Read', () => {
      const facts = extractFacts('Read', { file_path: '/src/index.ts' }, 'content');
      expect(facts[0].source).toBe('file-context');
    });

    it('returns file-context source for Edit', () => {
      const facts = extractFacts('Edit', { file_path: '/src/index.ts' }, 'edited');
      expect(facts[0].source).toBe('file-context');
    });

    it('returns tool-output source for Bash', () => {
      const facts = extractFacts('Bash', { command: 'npm install lodash' }, 'added 1 package');
      expect(facts[0].source).toBe('tool-output');
    });

    it('returns tool-output source for WebFetch', () => {
      const facts = extractFacts('WebFetch', { url: 'https://x.com' }, '404 not found');
      expect(facts[0].source).toBe('tool-output');
    });
  });

  describe('unknown tools', () => {
    it('skips tools that are not recognized', () => {
      const facts = extractFacts('UnknownTool', {}, 'some output');
      expect(facts).toHaveLength(0);
    });
  });
});
