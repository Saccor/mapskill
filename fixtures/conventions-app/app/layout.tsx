import { Nav } from './_components/Nav';

export const metadata = { title: 'Conventions' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
