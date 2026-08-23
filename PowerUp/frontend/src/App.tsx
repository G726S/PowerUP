import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { HomePage } from "./pages/HomePage";
import { CoursePage } from "./pages/CoursePage";
import { SessionProvider } from "./session/SessionContext";

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <AppHeader />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/courses/:courseId" element={<CoursePage />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
