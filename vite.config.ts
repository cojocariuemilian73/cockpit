import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pe GitHub Pages site-ul stă sub /cockpit/; local rămâne la rădăcină.
export default defineConfig({ plugins: [react()], base: process.env.BASE_PATH ?? "/" });
