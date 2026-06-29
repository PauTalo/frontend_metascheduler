/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Color corporativo UdL (Pantone 228 ≈ #890c58). El 600 es el oficial.
        brand: {
          50:  '#fbf0f6',
          100: '#f3d4e4',
          300: '#d77fad',
          400: '#c44a8e',
          500: '#a21a6c',
          600: '#890c58',
          700: '#62083f',
        },
      },
    },
  },
  plugins: [],
}
