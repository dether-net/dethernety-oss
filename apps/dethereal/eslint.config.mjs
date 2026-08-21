import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs', 'tsup.config.ts'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      // The rule's own option for the distinction it cannot otherwise draw:
      // AUTHORING a namespace, which is what it exists to discourage, versus
      // re-opening someone else's inside a `declare` block. The second is the
      // only syntax TypeScript has for merging into an interface that lives in
      // a namespace, and Apollo's default-options API is shaped that way — so
      // declaring a default is namespace syntax or nothing. Left as an error
      // everywhere else.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
);
