/** @type {import('tailwindcss').Config} */
import forms from '@tailwindcss/forms'

export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0891b2', // Cyan-600 - main teal/cyan color
          foreground: '#ffffff',
          light: '#2b6c77ff', // Cyan-500
          dark: '#256d81ff', // Cyan-700
        },
        accent: {
          DEFAULT: '#213145ff', // Dark navy blue
          light: '#87bbf3ff',
          dark: '#0f1f3a',
        },
        surface: {
          DEFAULT: '#f0f9ff', // Very light cyan
          dark: '#e0f2fe',
        }
      },
      boxShadow: {
        soft: '0 4px 24px rgba(8, 145, 178, 0.12)', // Teal shadow
        'soft-dark': '0 4px 24px rgba(30, 58, 95, 0.15)' // Navy shadow
      }
    },
  },
  plugins: [forms()],
}
