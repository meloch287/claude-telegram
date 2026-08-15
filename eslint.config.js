import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "data/**",
      "workspaces/**",
      "claude-home/**",
      "proxy/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Фронт мини-аппа — обычный браузерный JS без сборки и без модулей.
    files: ["src/miniapp/public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        fetch: "readonly",
        console: "readonly",
        Telegram: "readonly",
        location: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    rules: {
      // Пустой catch здесь — осознанный приём: «файла нет», «строка оборвалась»,
      // «уведомление не ушло». Такие места прокомментированы по месту.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Неиспользуемое с подчёркиванием — намеренно отброшенное, а не забытое.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
