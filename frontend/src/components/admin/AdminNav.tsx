"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/settings", label: "Settings" },
];

/** Sub-nav tabs shared by the admin area's pages. */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 border-b border-white/5 pb-2" aria-label="Admin">
      {links.map((link) => {
        const active = pathname?.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition",
              active
                ? "bg-white/10 text-white"
                : "text-slate-400 hover:bg-white/5 hover:text-white",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
