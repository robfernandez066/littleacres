import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // tools/art-studio and private are OWNER-PRIVATE sandboxes (untracked /
  // local-only): lint must stay green regardless of what lives there.
  { ignores: ['dist', 'node_modules', 'tools/art-studio', 'private'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  prettier,
);
