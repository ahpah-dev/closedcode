import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
 title: 'ClosedCode — Your ideas. Your agents. Your code.',
 description: 'An open source coding workspace with a thoughtful agent team, local execution, OmniRoute and automatic model fallback.',
 icons: {icon: '/favicon.svg'},
};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>) {return <html lang="en"><body>{children}</body></html>;}
