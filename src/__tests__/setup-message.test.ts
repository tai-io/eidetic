import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSetupErrorMessage, getWelcomeMessage } from '../setup-message.js';

describe('setup-message', () => {
  describe('getSetupErrorMessage', () => {
    it('returns error message with header for missing context', () => {
      const result = getSetupErrorMessage('OPENAI_API_KEY is not set.', 'missing');
      expect(result).toContain('No API key configured');
      expect(result).toContain('How to fix');
      expect(result).toContain('Get an API key');
    });

    it('returns error message for invalid context', () => {
      const result = getSetupErrorMessage('Connection refused', 'invalid');
      expect(result).toContain('Connection refused');
      expect(result).toContain('Verify your key');
    });

    it('includes OS-appropriate config instructions on Windows', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const result = getSetupErrorMessage('OPENAI_API_KEY is not set.', 'missing');
      expect(result).toContain('setx OPENAI_API_KEY');
      expect(result).not.toContain('~/.bashrc');

      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    it('includes OS-appropriate config instructions on Unix', () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const result = getSetupErrorMessage('OPENAI_API_KEY is not set.', 'missing');
      expect(result).toContain('export OPENAI_API_KEY');
      expect(result).not.toContain('setx');

      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    it('includes alternative methods section', () => {
      const result = getSetupErrorMessage('OPENAI_API_KEY is not set.', 'missing');
      expect(result).toContain('Alternative methods');
      expect(result).toContain('Ollama');
    });

    it('includes footer', () => {
      const result = getSetupErrorMessage('OPENAI_API_KEY is not set.', 'missing');
      expect(result).toContain('Restart Claude Code');
    });
  });

  describe('getWelcomeMessage', () => {
    it('includes ASCII art', () => {
      const result = getWelcomeMessage();
      expect(result).toContain('persistent memory');
      expect(result).toContain('AI agents');
    });

    it('includes quick start instructions', () => {
      const result = getWelcomeMessage();
      expect(result).toContain('add_memory');
      expect(result).toContain('search_memory');
    });

    it('mentions sessions', () => {
      const result = getWelcomeMessage();
      expect(result).toContain('sessions');
    });
  });
});
