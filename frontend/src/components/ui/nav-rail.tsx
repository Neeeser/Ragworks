"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useRef } from "react";

import { RailFlyout } from "@/components/ui/rail-flyout";
import { Tooltip } from "@/components/ui/tooltip";
import { useFlyoutIntent } from "@/components/ui/use-flyout-intent";
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

const ICON_BUTTON =
  "flex h-7 w-7 items-center justify-center rounded-control transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet";

type RailItemProps = {
  link: RailLink;
  active: boolean;
  intent: FlyoutIntent;
};

/**
 * One rail item, plus its flyout when the section has a preview.
 *
 * The flyout is a sibling of the link inside this wrapper rather than a portal,
 * which buys three things: the 8px bridge (`pl-2`) is inside the wrapper, so the
 * pointer never crosses a dead gap; `onBlur` can ask whether focus is still
 * anywhere in the group; and the panel's links sit right after the rail link in
 * the tab order, so a keyboard user tabs straight into them. Escape closes and
 * returns focus to the rail link, which is the way out of that list.
 */
function RailItem({ link, active, intent }: RailItemProps) {
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
        ICON_BUTTON,
        active
          ? "bg-accent-violet/15 text-primary ring-1 ring-inset ring-accent-violet/30"
          : "text-muted hover:bg-surface-strong hover:text-primary",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </Link>
  );

  if (!previewable) {
    return (
      <Tooltip content={link.label} side="right">
        {railLink}
      </Tooltip>
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
    // the panel, and moving focus back to the rail link fires this group's
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
 * The 46px icon rail.
 *
 * A rail rather than a top bar because the top bar cost 70px of height and was
 * what justified the centred `max-w-6xl` that stranded a third of the viewport.
 * 46px of width is not noticed; 70px of height plus page padding is.
 *
 * Every item is icon-only, so every item carries an accessible name — and, where
 * the section has a preview, a flyout that says what the section is and lists
 * where to go inside it.
 */
export function NavRail({ links, activeHref, footer }: NavRailProps) {
  const intent = useFlyoutIntent();

  return (
    <nav
      aria-label="Sections"
      className="flex w-[46px] shrink-0 flex-col items-center gap-1 border-r border-hairline bg-surface py-2"
    >
      <Link href="/dashboard" aria-label="Ragworks console" className={cn(ICON_BUTTON, "mb-1")}>
        <span className="relative block h-5 w-6" aria-hidden>
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
      </Link>

      {links.map((link) => (
        <RailItem
          key={link.href}
          link={link}
          active={activeHref?.startsWith(link.href) ?? false}
          intent={intent}
        />
      ))}

      {footer ? <div className="mt-auto flex flex-col items-center gap-1">{footer}</div> : null}
    </nav>
  );
}
