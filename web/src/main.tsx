import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { UiProvider } from "./state/ui";
import { WalletProvider } from "./state/wallet";
import "./styles/global.css";

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <UiProvider>
        <WalletProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletProvider>
      </UiProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
