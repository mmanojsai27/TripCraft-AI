/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: { brand: { 50: "#eef6ff", 100: "#d9eaff", 500: "#2f7df6", 600: "#1d63d8", 700: "#184fb0", 900: "#10264f" } },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
