import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Landing } from "./pages/Landing";
import { Live } from "./pages/Live";
import { SetBudget } from "./pages/SetBudget";
import { Vaults } from "./pages/Vaults";
import { Spenders } from "./pages/Spenders";
import { Ledger } from "./pages/Ledger";
import { Fuel } from "./pages/Fuel";
import { Agents } from "./pages/Agents";
import { Proof } from "./pages/Proof";
import { Connect } from "./pages/Connect";
import { useEffect } from "react";
import { refreshEvents } from "./state/data";

export function App() {
  // start reading the event history as soon as the app opens
  useEffect(() => { refreshEvents().catch(() => undefined); }, []);
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Landing />} />
        <Route path="live" element={<Live />} />
        <Route path="budget" element={<SetBudget />} />
        <Route path="vaults" element={<Vaults />} />
        <Route path="spenders" element={<Spenders />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="fuel" element={<Fuel />} />
        <Route path="agents" element={<Agents />} />
        <Route path="proof" element={<Proof />} />
        <Route path="connect" element={<Connect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
