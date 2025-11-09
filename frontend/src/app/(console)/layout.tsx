'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Bot, FolderTree, Home, MessageSquare } from 'lucide-react';

import { useAuth } from '@/providers/auth-provider';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navLinks = [
  { href: '/dashboard', label: 'Overview', icon: Home },
  { href: '/collections', label: 'Collections', icon: FolderTree },
  { href: '/chat', label: 'Chat Studio', icon: MessageSquare },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isChatRoute = pathname?.startsWith('/chat');

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/sign-in');
    }
  }, [loading, user, router]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Preparing your workspace…
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-screen flex-col bg-slate-950 text-slate-100', isChatRoute && 'h-screen')}>
      <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <Link href="/dashboard" className="flex items-center gap-3 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/20 text-violet-300">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-slate-400">TransparentRAG</p>
              <p className="text-lg font-semibold">Control Room</p>
            </div>
          </Link>
          <nav className="flex flex-1 justify-center gap-2 text-sm">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'rounded-full px-4 py-2 font-medium transition',
                    isActive
                      ? 'bg-white/15 text-white shadow shadow-violet-500/40'
                      : 'text-slate-400 hover:bg-white/5 hover:text-white',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <p className="font-semibold text-white">{user.full_name || user.email}</p>
              <p className="text-slate-400">{user.email}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main
        className={cn(
          'flex-1 px-4 py-6 lg:px-10 lg:py-8 min-h-0',
          isChatRoute && 'overflow-hidden',
        )}
      >
        {isChatRoute ? <div className="h-full">{children}</div> : children}
      </main>
    </div>
  );
}
