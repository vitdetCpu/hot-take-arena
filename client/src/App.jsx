import { BrowserRouter, Routes, Route } from 'react-router-dom';
import HostView from './pages/HostView';
import PlayerView from './pages/PlayerView';
import LandingView from './pages/LandingView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingView />} />
        <Route path="/host" element={<HostView />} />
        <Route path="/play" element={<PlayerView />} />
        <Route path="*" element={<LandingView />} />
      </Routes>
    </BrowserRouter>
  );
}
