import { Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import JoinPage from './pages/JoinPage';
import WaitingRoom from './pages/WaitingRoom';
import AdminDashboard from './pages/AdminDashboard';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/queue/:id/join" element={<JoinPage />} />
      <Route path="/queue/:id/wait" element={<WaitingRoom />} />
      <Route path="/admin" element={<AdminDashboard />} />
    </Routes>
  );
}
