"use client";

import {
  FolderTree,
  Gauge,
  GitBranch,
  Home,
  LogOut,
  MessageSquare,
  Settings,
  Shield,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { SetupStatusProvider } from "@/providers/setup-status-provider";

const navLinks = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/collections", label: "Collections", icon: FolderTree },
  { href: "/chat", label: "Chat Studio", icon: MessageSquare },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/evals", label: "Evals", icon: Gauge },
];

function ConsoleLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isChatRoute = pathname?.startsWith("/chat");
  const isPipelinesRoute = pathname?.startsWith("/pipelines");
  // The trace debugger is a full-viewport working surface, same as chat.
  const isFullHeightRoute = isChatRoute || pathname?.startsWith("/traces");
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

  const avatarSeed = user?.id || user?.email || "ragworks";
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
      return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
    }
    return label.slice(0, 1).toUpperCase();
  }, [user?.full_name, user?.email]);

  if (!user) {
    return <WorkspaceLoading />;
  }

  const links =
    user.role === "admin"
      ? [...navLinks, { href: "/admin", label: "Admin", icon: Shield }]
      : navLinks;

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col bg-canvas text-body",
        isFullHeightRoute && "h-screen",
        isPipelinesRoute && "xl:h-screen",
      )}
    >
      <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <Link href="/dashboard" className="flex items-center gap-3 text-primary">
            <span className="relative block h-[29px] w-14 shrink-0" aria-hidden>
              <Image
                src="/ragworks-mark-dark.svg"
                alt=""
                fill
                className="ragworks-mark-dark object-contain"
                unoptimized
              />
              <Image
                src="/ragworks-mark-light.svg"
                alt=""
                fill
                className="ragworks-mark-light object-contain"
                unoptimized
              />
            </span>
            <div className="hidden lg:block">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                Ragworks
              </p>
              <p className="text-lg font-semibold">Console</p>
            </div>
            <span className="sr-only">Ragworks console</span>
          </Link>
          <nav className="flex flex-1 justify-center gap-2 text-sm">
            {links.map((link) => {
              const isActive = pathname?.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-full px-4 py-2 font-medium transition whitespace-nowrap",
                    isActive
                      ? "bg-surface-strong text-primary shadow-glow"
                      : "text-muted hover:bg-surface hover:text-primary",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-xs lg:block">
              <p className="font-semibold text-primary">{user.full_name || user.email}</p>
              <p className="text-muted">{user.email}</p>
            </div>
            <ThemeToggle />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className={cn(
                  "rounded-full border border-hairline p-0.5 transition focus-visible:outline-none",
                  menuOpen ? "border-accent-violet" : "hover:border-strong",
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
                <div className="absolute right-0 mt-2 w-48 rounded-2xl border border-hairline bg-canvas-raised/95 p-2 shadow-elevation-2">
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-body transition hover:bg-surface"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Settings className="h-4 w-4 text-muted" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-body transition hover:bg-surface"
                    onClick={() => {
                      setMenuOpen(false);
                      signOut();
                    }}
                  >
                    <LogOut className="h-4 w-4 text-muted" />
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
          isFullHeightRoute && "overflow-hidden",
          isPipelinesRoute && "xl:overflow-hidden",
        )}
      >
        {isFullHeightRoute || isPipelinesRoute ? (
          <div className={cn(isFullHeightRoute && "h-full", isPipelinesRoute && "xl:h-full")}>
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SetupStatusProvider>
      <ConsoleLayoutContent>{children}</ConsoleLayoutContent>
    </SetupStatusProvider>
  );
}
