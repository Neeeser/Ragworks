"use client";

import { FolderTree, Gauge, GitBranch, Home, MessageSquare, Shield } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { AccountMenu } from "@/components/ui/account-menu";
import { AppShell } from "@/components/ui/app-shell";
import { CommandPalette } from "@/components/ui/command-palette";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { useAuth } from "@/providers/auth-provider";
import { SetupStatusProvider } from "@/providers/setup-status-provider";

import type { RailLink } from "@/components/ui/nav-rail";

const navLinks: RailLink[] = [
  { href: "/dashboard", label: "Overview", icon: Home },
  { href: "/collections", label: "Collections", icon: FolderTree },
  { href: "/chat", label: "Chat Studio", icon: MessageSquare },
  { href: "/pipelines", label: "Pipelines", icon: GitBranch },
  { href: "/evals", label: "Evals", icon: Gauge },
];

/**
 * Routes that own their own scroll regions rather than scrolling the page:
 * chat, the trace debugger, and the pipeline editor are full-viewport working
 * surfaces.
 */
function ownsScroll(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname.startsWith("/chat") ||
    pathname.startsWith("/traces") ||
    pathname.startsWith("/pipelines")
  );
}

function ConsoleLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/sign-in");
    }
  }, [loading, user, router]);

  if (!user) {
    return <WorkspaceLoading />;
  }

  const links =
    user.role === "admin"
      ? [...navLinks, { href: "/admin", label: "Admin", icon: Shield }]
      : navLinks;

  return (
    <>
      <AppShell
        links={links}
        activeHref={pathname ?? undefined}
        contentClassName={ownsScroll(pathname) ? "overflow-hidden" : undefined}
        railFooter={
          <>
            <ThemeToggle />
            <AccountMenu user={user} />
          </>
        }
      >
        {children}
      </AppShell>
      <CommandPalette
        items={links.map((link) => ({
          id: link.href,
          label: link.label,
          group: "Sections",
          href: link.href,
        }))}
      />
    </>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SetupStatusProvider>
      <ConsoleLayoutContent>{children}</ConsoleLayoutContent>
    </SetupStatusProvider>
  );
}
