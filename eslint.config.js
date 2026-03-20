import js from '@eslint/js';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Base configuration for all files
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/node_modules/**', 'dist/**', 'release/**', '**/*.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./src/backend/tsconfig.json', './src/frontend/tsconfig.json'],
      },
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
        Electron: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': ts,
      'unused-imports': unusedImports,
      'react': reactPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...ts.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '.*',
        caughtErrorsIgnorePattern: '^_',
      }],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-private-class-members': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-inner-declarations': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-case-declarations': 'off',
    },
  },
  // Frontend-specific overrides (React)
  {
    files: ['src/frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        NodeJS: 'readonly',
      },
      parserOptions: {
        project: './src/frontend/tsconfig.json',
      },
    },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react/react-in-jsx-scope': 'off', // Not needed with React 17+
    },
  },
  // Backend-specific overrides (Node)
  {
    files: ['src/backend/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
        Electron: 'readonly',
        NodeJS: 'readonly',
      },
      parserOptions: {
        project: './src/backend/tsconfig.json',
      },
    },
  },
  // Special case for vite.config.ts and scripts (no project)
  {
    files: ['src/frontend/vite.config.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  },
];