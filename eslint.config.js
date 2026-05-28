import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['out/', 'release/', 'node_modules/', 'coverage/', 'dist/']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['bin/**/*.js'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['src/renderer/**/*.{vue,ts}'],
    languageOptions: {
      globals: { ...globals.browser }
    }
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['*.vue', '**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off'
    }
  },
  prettier
)
