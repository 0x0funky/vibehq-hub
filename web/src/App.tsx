import React, { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Home } from './pages/Home';
import { TeamDashboard } from './pages/TeamDashboard';

export function App() {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <BrowserRouter>
            <style>{responsiveCSS}</style>

            <div className="vhq-layout">
                {/* Mobile top bar */}
                <header className="vhq-topbar">
                    <button className="vhq-hamburger" onClick={() => setSidebarOpen(true)}>
                        <span /><span /><span />
                    </button>
                    <span className="vhq-topbar-title">VibeHQ</span>
                </header>

                <div className="vhq-body">
                    <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                    <main className="vhq-main">
                        <Routes>
                            <Route path="/" element={<Home />} />
                            <Route path="/team/:name" element={<TeamDashboard />} />
                        </Routes>
                    </main>
                </div>
            </div>
        </BrowserRouter>
    );
}

const responsiveCSS = `
.vhq-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
}
.vhq-body {
    display: flex;
    flex: 1;
    overflow: hidden;
}
.vhq-main {
    flex: 1;
    overflow: auto;
    padding: 24px;
}

/* Top bar — hidden on desktop */
.vhq-topbar {
    display: none;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
}
.vhq-topbar-title {
    font-size: 18px;
    font-weight: 700;
    color: #58a6ff;
}
.vhq-hamburger {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
}
.vhq-hamburger span {
    display: block;
    width: 20px;
    height: 2px;
    background: #c9d1d9;
    border-radius: 1px;
}

/* ---- Mobile ---- */
@media (max-width: 768px) {
    .vhq-topbar { display: flex; }
    .vhq-main { padding: 14px; }

    /* Sidebar slides from left */
    .vhq-sidebar {
        position: fixed !important;
        top: 0; left: 0; bottom: 0;
        transform: translateX(-100%);
        z-index: 50;
    }
    .vhq-sidebar.open {
        transform: translateX(0);
    }

    /* Close button visible */
    .vhq-sidebar-close { display: block !important; }

    /* Responsive grids */
    .vhq-overview { grid-template-columns: 1fr 1fr !important; }
    .vhq-team-grid { grid-template-columns: 1fr !important; }
    .vhq-agent-grid { grid-template-columns: 1fr !important; }
    .vhq-terminal-grid { grid-template-columns: 1fr !important; }
}
`;
