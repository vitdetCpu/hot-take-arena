import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HostView from './pages/HostView';
import PlayerView from './pages/PlayerView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/host" element={<HostView />} />
        <Route path="/play" element={<PlayerView />} />
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
