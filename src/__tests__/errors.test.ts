import { describe, it, expect } from 'vitest';
import { EideticError, ConfigError, EmbeddingError, MemoryError } from '../errors.js';

describe('Error hierarchy', () => {
  const errorClasses = [
    { Class: ConfigError, name: 'ConfigError' },
    { Class: EmbeddingError, name: 'EmbeddingError' },
    { Class: MemoryError, name: 'MemoryError' },
  ];

  for (const { Class, name } of errorClasses) {
    it(`${name} is instanceof EideticError and Error`, () => {
      const err = new Class('test message');
      expect(err).toBeInstanceOf(EideticError);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('test message');
      expect(err.name).toBe(name);
    });

    it(`${name} preserves cause`, () => {
      const cause = new Error('root cause');
      const err = new Class('wrapper', cause);
      expect(err.cause).toBe(cause);
    });
  }

  it('EideticError itself works correctly', () => {
    const err = new EideticError('base error');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('base error');
    expect(err.name).toBe('EideticError');
  });
});
