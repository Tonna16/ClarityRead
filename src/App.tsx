import  { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './components/Sidebar';
import Reader from './pages/Reader';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import AISummarizer from './pages/AISummarizer';
import ThemeToggle from './components/ThemeToggle';

type Page = 'reader' | 'analytics' | 'settings' | 'summarizer';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('reader');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const renderPage = () => {
    switch (currentPage) {
      case 'reader':
        return <Reader />;
      case 'analytics':
        return <Analytics />;
      case 'settings':
        return <Settings />;
      case 'summarizer':
        return <AISummarizer />;
      default:
        return <Reader />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Sidebar 
        currentPage={currentPage} 
        setCurrentPage={setCurrentPage}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />
      
      <main className={`flex-1 flex flex-col transition-all duration-300 ease-in-out ${
        sidebarCollapsed ? 'ml-16' : 'ml-64'
      }`}>
        <header className="h-16 bg-white dark:bg-gray-800 material-elevation-1 flex items-center justify-between px-6 z-10">
          <motion.h1 
            className="text-2xl font-bold text-blue-600 dark:text-blue-400"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            ClarityRead
          </motion.h1>
          <ThemeToggle />
        </header>
        
        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="h-full"
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default App;
 