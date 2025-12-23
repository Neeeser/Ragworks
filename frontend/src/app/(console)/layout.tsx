"use client";

import { Bot, FolderTree, GitBranch, Home, LogOut, MessageSquare, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

const navLinks = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/collections", label: "Collections", icon: FolderTree },
  { href: "/chat", label: "Chat Studio", icon: MessageSquare },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
];

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isChatRoute = pathname?.startsWith("/chat");
  const isPipelinesRoute = pathname?.startsWith("/pipelines");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/sign-in");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointer = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const avatarSeed = user?.id || user?.email || "transparentrag";
  const avatarStyle = useMemo(() => {
    let hash = 0;
    for (let idx = 0; idx < avatarSeed.length; idx += 1) {
      hash = (hash * 31 + avatarSeed.charCodeAt(idx)) % 360;
    }
    const hueA = hash % 360;
    const hueB = (hash * 3 + 120) % 360;
    const hueC = (hash * 7 + 240) % 360;
    const hueD = (hash * 11 + 60) % 360;
    return {
      backgroundImage: `
        radial-gradient(circle at 25% 20%, hsla(${hueA}, 80%, 60%, 0.9), transparent 55%),
        radial-gradient(circle at 75% 25%, hsla(${hueB}, 75%, 55%, 0.85), transparent 60%),
        radial-gradient(circle at 35% 80%, hsla(${hueC}, 70%, 50%, 0.8), transparent 55%),
        linear-gradient(135deg, hsl(${hueD}, 45%, 28%), hsl(${hueA}, 50%, 24%))
      `,
    };
  }, [avatarSeed]);
  const avatarLabel = useMemo(() => {
    const label = (user?.full_name || user?.email || "U").trim();
    const parts = label.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    }
    return label.slice(0, 1).toUpperCase();
  }, [user?.full_name, user?.email]);

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Preparing your workspace…
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-slate-950 text-slate-100",
        isChatRoute && "h-screen",
        isPipelinesRoute && "xl:h-screen",
      )}
    >
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
                    "rounded-full px-4 py-2 font-medium transition",
                    isActive
                      ? "bg-white/15 text-white shadow shadow-violet-500/40"
                      : "text-slate-400 hover:bg-white/5 hover:text-white",
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
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className={cn(
                  "rounded-full border border-white/10 p-0.5 transition focus-visible:outline-none",
                  menuOpen ? "border-violet-400" : "hover:border-white/30",
                )}
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={avatarStyle}
                >
                  {avatarLabel}
                </div>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-xl">
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Settings className="h-4 w-4 text-slate-300" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                  >
                    <LogOut className="h-4 w-4 text-slate-300" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main
        className={cn(
          "flex-1 px-4 py-6 lg:px-10 lg:py-8 min-h-0",
          isChatRoute && "overflow-hidden",
          isPipelinesRoute && "xl:overflow-hidden",
        )}
      >
        {isChatRoute || isPipelinesRoute ? (
          <div className={cn(isChatRoute && "h-full", isPipelinesRoute && "xl:h-full")}>
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
