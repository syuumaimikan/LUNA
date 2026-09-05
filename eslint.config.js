import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // DESIGN.md §20: 乱数と時刻は必ず注入する。直呼びを禁止して
      // 振る舞い・親密度・タイマーをテスト可能に保つ。
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Clock を注入して使うこと (src/shared/time.ts)' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Math.random() ではなく Rng を注入すること (src/shared/rng.ts)',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Date.now() ではなく Clock を注入すること (src/shared/time.ts)',
        },
      ],
    },
  },
  {
    // 時計と乱数の実装本体、およびテストは対象外
    files: ['src/shared/time.ts', 'src/shared/rng.ts', 'tests/**/*.ts'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-syntax': 'off' },
  },
)
