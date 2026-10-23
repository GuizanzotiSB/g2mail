import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G2 Mail",
  description: "Email marketing e automações da G2 Educação",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
