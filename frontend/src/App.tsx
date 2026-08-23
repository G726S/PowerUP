import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { HomePage } from "./pages/HomePage";
import { CoursePage } from "./pages/CoursePage";
import { LandingPage } from "./pages/LandingPage";
import { SessionProvider } from "./session/SessionContext";

export default function App() {
  // Plain component state, no persistence -- a full page load/reload
  // remounts App from scratch (state resets to true, landing shows again),
  // while client-side navigation between routes never remounts App at all
  // (React Router only swaps what <Routes> renders), so dismissing it once
  // holds for the rest of that session without needing sessionStorage.
  const [showLanding, setShowLanding] = useState(true);

  return (
    <SessionProvider>
      <BrowserRouter>
        {showLanding && <LandingPage onDismiss={() => setShowLanding(false)} />}
        <AppHeader />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses/:courseId" element={<CoursePage />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
