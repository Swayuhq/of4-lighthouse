import type { Metadata } from 'next';
import { Atkinson_Hyperlegible } from 'next/font/google';
import './globals.css';

const type = Atkinson_Hyperlegible({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-atkinson' });

export const metadata: Metadata = {
  title: 'Lighthouse',
  description: 'Every customer message in one list. Nothing missed.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={type.variable}>
      <body>{children}</body>
    </html>
  );
}
