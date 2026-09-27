import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LockSmith — zero-downtime migration gate",
  description:
    "LockSmith catches PostgreSQL migrations that would lock production, proves the lock in a real embedded Postgres, and uses IBM Bob to rewrite them safely.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
          <nav className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
                <path d="M11 14v-3a5 5 0 0 1 10 0v3" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
                <rect x="8" y="14" width="16" height="12" rx="3" fill="var(--accent)" />
                <circle cx="16" cy="20" r="2" fill="var(--bg)" />
              </svg>
              <span className="hidden sm:inline">LockSmith</span>
            </Link>
            <div className="flex items-center gap-4 text-sm text-muted sm:gap-5">
              <Link href="/report" className="hover:text-text">Report</Link>
              <Link href="/analyze" className="hover:text-text">Analyze SQL</Link>
              <Link href="/bob" className="hover:text-text">Bob workflow</Link>
            </div>
            <a
              href="https://github.com/kmt9967/locksmith-ibm-bob"
              className="ml-auto hidden text-sm text-muted hover:text-text sm:block"
            >
              GitHub
            </a>
          </nav>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted">
          Built for the IBM Bob 2.0 Hackathon (lablab.ai) · MIT licensed · Demo data is fictional
        </footer>
      </body>
    </html>
  );
}
