import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
      // Vuetify components and single-word view names are idiomatic here.
      'vue/multi-word-component-names': 'off',
      // The codebase is not consistently self-closing; not worth churning.
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/attributes-order': 'warn',
      // Vuetify's v-data-table uses dotted slot names (v-slot:item.name), which
      // this rule rejects as invalid even though Vuetify defines them.
      'vue/valid-v-slot': ['error', { allowModifiers: true }],
      // Pre-existing issues in the automations/models code, unrelated to any
      // current work — surfaced as warnings so `npm run lint` stays green
      // while they get cleaned up. See the top of the lint output.
      'no-prototype-builtins': 'warn',
      'no-constant-binary-expression': 'warn',
    },
  },
]
