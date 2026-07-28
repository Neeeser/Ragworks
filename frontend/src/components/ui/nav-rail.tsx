"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId, useRef } from "react";

import { RailFlyout } from "@/components/ui/rail-flyout";
import { Tooltip } from "@/components/ui/tooltip";
import { useFlyoutIntent } from "@/components/ui/use-flyout-intent";
import { useNavCollapsed } from "@/components/ui/use-nav-collapsed";
import { hasRailPreview } from "@/lib/rail-preview-cache";
import { cn } from "@/lib/utils";

import type { FlyoutIntent } from "@/components/ui/use-flyout-intent";
import type { LucideIcon } from "lucide-react";
import type { FocusEvent, KeyboardEvent } from "react";

export type RailLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavRailProps = {
  links: RailLink[];
  /** Matched with `startsWith` so nested routes keep their section active. */
  activeHref?: string;
  /** Account menu, theme control — pinned to the bottom. */
  footer?: React.ReactNode;
};

const ITEM =
  "relative flex h-8 w-full items-center gap-2 rounded-control px-2 text-ui transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet";

type RailItemProps = {
  link: RailLink;
  active: boolean;
  collapsed: boolean;
  intent: FlyoutIntent;
};

/**
 * One sidebar item — visible icon + label — plus its flyout when the section
 * has a preview.
 *
 * The flyout is a sibling of the link inside this wrapper rather than a portal,
 * which buys three things: the 8px bridge (`pl-2`) is inside the wrapper, so the
 * pointer never crosses a dead gap; `onBlur` can ask whether focus is still
 * anywhere in the group; and the panel's links sit right after the sidebar link
 * in the tab order, so a keyboard user tabs straight into them. Escape closes
 * and returns focus to the sidebar link, which is the way out of that list.
 */
function RailItem({ link, active, collapsed, intent }: RailItemProps) {
  const Icon = link.icon;
  const linkRef = useRef<HTMLAnchorElement>(null);
  const descriptionId = useId();
  const previewable = hasRailPreview(link.href);
  const open = previewable && intent.openId === link.href;

  const railLink = (
    <Link
      ref={linkRef}
      href={link.href}
      aria-label={link.label}
      aria-current={active ? "page" : undefined}
      aria-describedby={open ? descriptionId : undefined}
      onClick={intent.close}
      className={cn(
        ITEM,
        collapsed && "justify-center px-0",
        active
          ? "bg-accent-violet/12 font-medium text-primary"
          : "text-muted hover:bg-surface-strong hover:text-primary",
      )}
    >
      {/* The trace wire — the "you are here" mark on the active section. */}
      {active ? (
        <span className="trace-wire absolute inset-y-1.5 left-0 w-[2px] rounded-full" aria-hidden />
      ) : null}
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {collapsed ? null : <span className="truncate">{link.label}</span>}
    </Link>
  );

  if (!previewable) {
    // Collapsed items hide their label, so the name comes back as a tooltip;
    // expanded items already show it and need none.
    return collapsed ? (
      <Tooltip content={link.label} side="right">
        {railLink}
      </Tooltip>
    ) : (
      railLink
    );
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    intent.close();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.stopPropagation();
    // Focus first, close second. Escape usually comes from a destination inside
    // the panel, and moving focus back to the sidebar link fires this group's
    // onFocus — which reopens what Escape just dismissed. Both updates land in
    // one React batch, so closing last is what wins.
    linkRef.current?.focus();
    intent.close();
  };

  return (
    <div
      className="relative"
      onPointerEnter={() => intent.hoverStart(link.href)}
      onPointerLeave={intent.hoverEnd}
      onFocus={() => intent.focusOpen(link.href)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {railLink}
      {open ? (
        <div className="absolute left-full top-0 z-40 pl-2">
          <RailFlyout
            href={link.href}
            label={link.label}
            descriptionId={descriptionId}
            onNavigate={intent.close}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The labeled sidebar — 184px, wordmark on top, one visible icon + label per
 * section, account controls pinned to the bottom. Collapsible to a 48px icon
 * rail (expanded is the default; the choice persists per browser).
 *
 * Labels are visible because nobody should hover to learn what an icon means;
 * the flyouts add depth (what the section is + recent destinations) on top of
 * that, not instead of it. Collapsed, the labels return as tooltips and the
 * flyouts keep carrying the section names. Active state is the accent fill
 * plus the trace-wire edge — one of the console's signature marks.
 */
export function NavRail({ links, activeHref, footer }: NavRailProps) {
  const intent = useFlyoutIntent();
  const [collapsed, setCollapsed] = useNavCollapsed();

  return (
    // Desktop-only: below lg the shell renders `MobileNavBar` along the bottom
    // edge instead — a side rail spends a fixed slice of a phone's width on
    // every page.
    <nav
      aria-label="Sections"
      className={cn(
        // The user moved it → 160ms decel, per the motion table.
        "relative flex shrink-0 flex-col gap-1 border-r border-hairline bg-surface py-3 transition-[width] duration-160 ease-decel max-lg:hidden motion-reduce:transition-none",
        collapsed ? "w-12 px-1.5" : "w-[184px] px-2",
      )}
    >
      <div className={cn("mb-2 flex items-center", collapsed ? "justify-center" : "gap-1 pr-1")}>
        <Link
          href="/dashboard"
          aria-label="Ragworks console"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-control px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
            collapsed && "px-1",
          )}
        >
          <span className="relative block h-5 w-6 shrink-0" aria-hidden>
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
          {collapsed ? null : (
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em] text-primary">
              Ragworks
            </span>
          )}
        </Link>
        {collapsed ? null : (
          <Tooltip content="Collapse navigation" side="right">
            <button
              type="button"
              aria-label="Collapse navigation"
              aria-expanded
              onClick={() => setCollapsed(true)}
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>

      {collapsed ? (
        <Tooltip content="Expand navigation" side="right">
          <button
            type="button"
            aria-label="Expand navigation"
            aria-expanded={false}
            onClick={() => setCollapsed(false)}
            className="mb-1 flex h-8 w-full items-center justify-center rounded-control text-muted transition-colors duration-80 ease-standard hover:bg-surface-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      ) : null}

      {links.map((link) => (
        <RailItem
          key={link.href}
          link={link}
          active={activeHref?.startsWith(link.href) ?? false}
          collapsed={collapsed}
          intent={intent}
        />
      ))}

      {footer ? (
        <div
          className={cn("mt-auto flex items-center gap-1", collapsed ? "flex-col px-0" : "px-1")}
        >
          {footer}
        </div>
      ) : null}
    </nav>
  );
}
