import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Moon, Sun } from 'lucide-react';
import App from './App.jsx';
import './styles.css';

function readTheme() {
  try {
    return localStorage.getItem('nootion-theme') === 'dark' ? 'dark' : 'light';
  } catch (error) {
    console.error('Could not read the saved theme.', error);
    return 'light';
  }
}

document.documentElement.dataset.theme = readTheme();

function ThemedApp() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme);
  const [themeError, setThemeError] = useState(null);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
    setThemeError(null);
    try {
      localStorage.setItem('nootion-theme', nextTheme);
    } catch (error) {
      console.error('Could not save the theme.', error);
      setThemeError('Theme changed, but this browser could not save your preference.');
    }
  };

  return (
    <>
      <App />
      <button type="button" className="theme-switch" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>
        {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
      </button>
      {themeError && <div className="error-toast" role="alert">{themeError}</div>}
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemedApp />
  </StrictMode>,
);
