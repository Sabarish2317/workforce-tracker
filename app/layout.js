import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata = {
  title: 'Fleet Tracker — Admin',
  description: 'On-duty field workforce dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
