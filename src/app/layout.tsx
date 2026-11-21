import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Logo } from "@/components/brand/Logo";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: {
    default: "Minuta Życia — najbliższy AED i instrukcja użycia",
    template: "%s · Minuta Życia",
  },
  description:
    "Otwarte dane o defibrylatorach AED w Polsce i interaktywna instrukcja użycia AED.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1211" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2"
        >
          Przejdź do treści
        </a>
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="-ml-1 flex items-center rounded-lg text-text" aria-label="Minuta Życia — strona główna">
              <Logo className="h-10 w-auto sm:h-12" />
            </Link>
            <a
              href="tel:112"
              className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-on-danger hover:opacity-90"
            >
              <span className="hidden sm:inline">Nagły wypadek? </span>Zadzwoń 112
            </a>
          </div>
        </header>
        <Providers>
          <main id="main" className="flex-1">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
