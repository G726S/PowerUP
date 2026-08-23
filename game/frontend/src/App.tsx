import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { PointsProvider } from "./hooks/usePoints";
import { HomePage } from "./pages/HomePage";
import { CoursePage } from "./pages/CoursePage";
import { GamePage } from "./pages/GamePage";
import { MonkeyGamePage } from "./pages/MonkeyGamePage";

export default function App() {
  return (
    <PointsProvider>
      <BrowserRouter>
        <AppHeader />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses/:courseId" element={<CoursePage />} />
          <Route path="/game" element={<GamePage />} />
          <Route path="/climb" element={<MonkeyGamePage />} />
        </Routes>
      </BrowserRouter>
    </PointsProvider>
  );
}
