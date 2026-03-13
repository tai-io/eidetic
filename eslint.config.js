// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '.worktrees/', 'scripts/'],
  },

  // Base recommended rules
  eslint.configs.recommended,

  // TypeScript strict + stylistic with type checking
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // TypeScript project config
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Main source rules
  {
    rules: {
      // Downgrade unsafe rules to warn (MCP SDK is loosely typed)
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // Allow numbers (and booleans) in template literals — common logging pattern
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],

      // Warn on || where ?? would work — many env-var patterns use || undefined intentionally
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',

      // Warn rather than error — while(true) loops and Record<string,T> index access
      // produce many false positives without noUncheckedIndexedAccess in tsconfig
      '@typescript-eslint/no-unnecessary-condition': 'warn',

      // Warn on Object-to-string — unknown catch vars are stringified intentionally
      '@typescript-eslint/no-base-to-string': 'warn',

      // Allow empty arrow functions (fire-and-forget .catch(() => {}))
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['arrowFunctions'] },
      ],

      // Allow _-prefixed unused variables
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Test file overrides — relaxed rules for mocks and test helpers
  {
    files: ['**/*.test.ts', '**/__tests__/**/*.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Mock implementations often satisfy interfaces with async signatures
      '@typescript-eslint/require-await': 'off',
      // Test files routinely use unbound methods for spying
      '@typescript-eslint/unbound-method': 'off',
      // Mock objects may not have strict nullability
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Relaxed for test setup helpers
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      // Mocks stringify payload fields that are typed as unknown
      '@typescript-eslint/no-base-to-string': 'off',
      // Test helpers and integration tests use + with any-typed values
      '@typescript-eslint/restrict-plus-operands': 'off',
      // Test scaffolding classes with only constructors are common
      '@typescript-eslint/no-extraneous-class': 'off',
      // Tests import utilities that may not all be used in every test
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Prettier last — disables formatting conflicts
  prettierConfig,
);
