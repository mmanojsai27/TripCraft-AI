/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: { brand: { 50: "#eef6ff", 100: "#d9eaff", 500: "#2f7df6", 600: "#1d63d8", 700: "#184fb0", 900: "#10264f" } },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(24px) scale(.98)" }, "100%": { opacity: "1", transform: "none" } },
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        kenburns: { "0%": { transform: "scale(1) translate(0,0)" }, "100%": { transform: "scale(1.15) translate(-2%,-2%)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        grow: { "0%": { width: "0%" } },
      },
      animation: {
        rise: "rise .7s cubic-bezier(.22,1,.36,1) both",
        fadeIn: "fadeIn 1.2s ease both",
        kenburns: "kenburns 14s ease-in-out infinite alternate",
        float: "float 4s ease-in-out infinite",
        shimmer: "shimmer 3s linear infinite",
        grow: "grow 1.2s cubic-bezier(.22,1,.36,1) both",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};