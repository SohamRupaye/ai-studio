import { Routes, Route } from "react-router-dom";
import { Sidebar } from "./components/sidebar";
import { ChatView } from "./components/chat-view";
import { RightPanel } from "./components/right-panel";
import { TitleBar } from "./components/title-bar";
import { useTheme } from "./hooks/use-theme";

export default function App() {
  useTheme();
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex flex-1 overflow-hidden">
          <Routes>
            <Route path="*" element={<ChatView />} />
          </Routes>
        </main>
        <RightPanel />
      </div>
    </div>
  );
}
