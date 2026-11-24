import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThemeProvider, applyThemeToDocument, readStoredTheme } from "./theme";
import { HostedApp } from "./hosted/auth";
import { createHostedClient, setHostedClient } from "./hosted/client";
import { loadHostedConfig } from "./hosted/config";
import "./styles.css";

// Apply the stored theme before the first paint; no flash of the wrong palette.
applyThemeToDocument(readStoredTheme());

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

async function boot(): Promise<void> {
  const config = await loadHostedConfig();
  let tree = <App />;
  if (config) {
    const client = createHostedClient(config);
    tree = (
      <HostedApp client={client}>
        <App />
      </HostedApp>
    );
  } else {
    setHostedClient(null);
  }
  createRoot(root!).render(
    <StrictMode>
      <ThemeProvider>{tree}</ThemeProvider>
    </StrictMode>,
  );
}

void boot();

// Production only. Service workers need a secure context (localhost or HTTPS),
// so a LAN HTTP phone session simply runs without one. Registration is silent:
// Electron and unsupported browsers keep working exactly as before.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline caching is optional; never surface this to the app.
    });
  });
}
