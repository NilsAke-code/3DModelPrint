import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import ModelDetail from './pages/ModelDetail';
import Library from './pages/Library';
import Upload from './pages/Upload';
import Import from './pages/Import';
import MakerWorldImport from './pages/MakerWorldImport';
import Admin from './pages/Admin';
import { SharedRendererProvider } from './contexts/SharedModelRenderer';

export default function App() {
  return (
    <SharedRendererProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/model/:id" element={<ModelDetail />} />
            <Route path="/library" element={<Library />} />
            <Route path="/library/upload" element={<Upload />} />
            <Route path="/library/import-makerworld" element={<MakerWorldImport />} />
            <Route path="/import" element={<Import />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SharedRendererProvider>
  );
}
