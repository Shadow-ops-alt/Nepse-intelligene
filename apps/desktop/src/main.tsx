import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider, applyThemeToDocument, readStoredTheme } from "./theme";
import "./styles.css";

// Apply the stored theme before the first paint; no flash of the wrong palette.
applyThemeToDocument(readStoredTheme());

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
