import React from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import ClosedCode from '../components/closedcode/workspace';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ClosedCode /></React.StrictMode>);
