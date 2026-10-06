import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Login from "./pages/Login";
import SignUp from "./pages/SignUp";
import Home from "./pages/Home";
import FAQ from "./pages/FAQ";
import SavedRoutes from "./pages/SavedRoutes";
import UserSettings from "./pages/UserSettings";


function PrivateRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("access");
  return token ? children : <Navigate to="/login" replace state={{ from: location }} />;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/home" element={<Home />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />

        <Route
          path="/savedroutes"
          element={
            <PrivateRoute>
              <SavedRoutes />
            </PrivateRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <UserSettings />
            </PrivateRoute>
          }
        />
      </Routes>
    </Router>
  );
}
