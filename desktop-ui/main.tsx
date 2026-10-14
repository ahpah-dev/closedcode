import React from 'react';
import { createRoot } from 'react-dom/client';
import ClosedCode from '../components/closedcode/workspace';
import '../app/globals.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ClosedCode /></React.StrictMode>);
